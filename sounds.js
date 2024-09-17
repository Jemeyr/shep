
//Visualizer stuff
function setUpVisualizer(analyser){

    //Setting up canvas
    var visualizer = document.querySelector('.visualizer');
    var WIDTH = visualizer.width;
    var HEIGHT = visualizer.height;
    var visualizerContext = visualizer.getContext('2d');

    //Setting up analyser
    analyser.fftSize = 1024;//meh
    var bufferLength = analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);
    visualizerContext.clearRect(0, 0, WIDTH, HEIGHT);


    //TODO the 0.9 and 1.2 are fudge factors taht seem to be needed but shouldn't be
    //scale the width and don't render empty triangles for frequencies we filter out 
    var analyserFrequencyScalar = (48000 / (2 * highestFreq));
    var barWidth = (WIDTH / bufferLength) * analyserFrequencyScalar * 0.9;
    var analyserLoopAmount = (bufferLength / analyserFrequencyScalar) * 1.2;
    var barMaxHeight = 260; //pixels
    function draw() {
      drawVisual = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      visualizerContext.fillStyle = 'rgb(30,0,30)';
      // visualizerContext.setTransform(1, 0, 0, 1, 0, 0);

      visualizerContext.fillRect(0, 0, WIDTH, HEIGHT);


      for (i = 0; i < analyserLoopAmount; i++) {
        barHeight = dataArray[i] * (barMaxHeight / 255);
        visualizerContext.fillStyle = `rgb(${120-barHeight/2},${barHeight},0)`;

        visualizerContext.fillRect(barWidth * i, HEIGHT - barHeight, barWidth, barHeight);
      }

    };
    draw();
}



//TODO ok so this is 6 powers of 2 apart, as in 7040/110 = 64 = 2^6
//TODO therefore 1.0 in "phase" is functionally "6 octaves"
var lowestFreq = 110;//A2
var highestFreq = 7040;//A8
var octaveSpan = 6;

//calculated shit
//Ok basically we need to find out what frequency is logarithmically 1 Nth (For n oscillators) of the range from low to high
var logRange = Math.log(highestFreq) / Math.log(lowestFreq)


//TODO check these are not borked and reenable
function getFadeInCutoff(oscAmt){
  return highestFreq;//lowestFreq + Math.pow(lowestFreq, logRange/oscAmt)
}

function getFadeOutCutoff(oscAmt){
  return lowestFreq// + Math.pow(lowestFreq, (logRange * (oscAmt - 1))/oscAmt)
}


//TODO TODO this uses a bunch of jankily far away state. Also the math seems wrong
//TODO this maps a "phase" to a frequency. Phases should basically map a 0-1 range to some number of octaves (2-4?) with a shepard tone wrapping such that 0 = 1 
function toFrequency(phase){
  //Temp hax 4x here puts a single sin wave per note in usable frequencies  
  return lowestFreq * Math.pow(2, octaveSpan * phase);
}

//Phase here is a number between 0-1, I guess it should map to some number of oscillators
//oscs is the number of oscillators
//context is the audio context 
function createNote(phase, oscAmt, context){
  note = {}
  note.oscs = []
  //note.oscPhases = []
  note.gains = []
  note.volume = context.createGain()

  //Start muted
  note.volume.gain.value = 0.0

  for (i = 0; i < oscAmt; i++) {
    var osc = context.createOscillator();
    osc.type = 'sine'
    
    var gain = context.createGain()
    gain.gain.value = 1.0

    //each osc in a note has its own gain to fade in/out appropriately, and then a note overall volume
    osc.connect(gain)
    gain.connect(note.volume)

    //These notes aren't sorted out yet, we define a function to manage them and then call it later
    note.oscs[i] = osc
    note.gains[i] = gain
  }

  note.setVolume = function(newVolume){    
    this.volume.gain.value = newVolume;
  }

  note.setPhase = function(newPhase){
    console.log(`setting phase to ${phase}`)
    this.phase = newPhase
    var oscAmt= note.oscs.length

    var fadeInCutoff = getFadeInCutoff(oscAmt); 
    var fadeOutCutoff = getFadeOutCutoff(oscAmt); 

    for (i = 0; i< oscAmt; i++){
      var frequency = toFrequency((newPhase + ((i === 0 ? 0 : Math.log(i+1)) / Math.log(2))/octaveSpan) %1.0 );
      this.oscs[i].frequency.value = frequency; //Apply new frequency to oscillator.


      //Kinda janky. Keep in mind each note has its own master, which scales overall note volume
      if (frequency < lowestFreq) {
        this.gains[i].gain.value = 0;
      } else if(frequency < fadeInCutoff){
        //at lowest it should be 0, at cutoff it should be 1
        this.gains[i].gain.value = ((frequency-lowestFreq) / (fadeInCutoff - lowestFreq));
      } else if(frequency < fadeOutCutoff){
        this.gains[i].gain.value = 1;  
      } else if(frequency < highestFreq) {
        //at cutoff it's 1, at highest it's 0
        this.gains[i].gain.value = ((highestFreq - frequency) / (highestFreq - fadeOutCutoff));
      } else if(frequency >= highestFreq) {
        this.gains[i].gain.value = 0;
      }
    }
  }

  note.setVolume(0)
  note.setPhase(phase)

  for (i = 0; i < oscAmt; i++) {  
    note.oscs[i].start(0)
  }

  return note
}



//static things for the grid
var grid;
var gridX;
var gridY;
var gridBoxX, gridBoxY;
var gridSize = 5; //The NxN grid to make
var squares = [...new Array(gridSize)].map((a,i) => [...new Array(gridSize)].map((a,i) => {return {selected: false};}));
var gridContext;
var maxNotes = 5;
//Hold list of coords instead of counts to scale up to infinite squares in future
var currentlySelected = [];


//static things for sound
var audioContext;
var master; //master gain node, for muting
var mute = false;
var gainVal = 0.2; //Sets gain value. Keep low!

//TODO some note data here?
var notes = []


function updateNotes(){
  if(!notes.length){
    return;
  }
  currentlySelected.forEach(function(box, i) {
    var note = notes[i]
    note.setVolume(1);
    //accordion mode?
    note.setPhase(((box.y*4 + 7*box.x)/(octaveSpan*12))%1.0)
  })
  for(var i = currentlySelected.length; i<maxNotes; i++){
    notes[i].setVolume(0)
  }

  //1/(octaveSpan*12) -> semitone
  //TODO I guess figure out how integer ratios fit into the 'phase' scheme...
}



//draw grid
function drawGrid(){
  gridContext.fillStyle = `rgb(0,0,0)`;

  gridContext.fillRect(0,0,gridX, gridY);

  squares.forEach((row, i) => {
    row.forEach((square, j) => {
      gridContext.fillStyle = (square.selected) ? 'rgb(0,120,120)' : 'rgb(0,30,30)';
      gridContext.fillRect(gridBoxX*j + 1, gridBoxY*i +1, gridBoxX -2, gridBoxY-2);
    });
  });
}



function toggleMute(){
  mute = !mute;
  if(master){
      if (mute) {
        master.gain.value = 0;
      } else {
        master.gain.value = gainVal;
      }
  }
}


function handleClick(event){
  if(!notes.length){
    return;//need to click start since user input is needed to trigger an audiocontext
  }

  bounds = grid.getBoundingClientRect();

  var x = Math.floor((event['clientX'] - bounds.left) / gridBoxX);
  var y = Math.floor((event['clientY'] - bounds.top) / gridBoxY);

  if(currentlySelected.length < maxNotes || squares[y][x].selected){
    if(squares[y][x].selected){
      currentlySelected.pop({x,y})
    } else {
      currentlySelected.push({x,y})
    }
    squares[y][x].selected = !squares[y][x].selected;
  }

  updateNotes()

  drawGrid()
}



//Page load, fetch things like canvas context
function load(){
    grid = document.querySelector('.grid');
    gridX = grid.width;
    gridY = grid.height;
    console.log('setting grid box size')
    gridBoxX = gridX/gridSize;
    gridBoxY = gridY/gridSize;
    gridContext = grid.getContext('2d');
    drawGrid()
}

function start(){
    document.getElementById('startButton').remove()
    document.getElementById('muteButton').className='btn-mute-visible'



    audioContext = new AudioContext(); 
    master = audioContext.createGain();
    master.gain.value = gainVal;



    // var filter = filter = audioContext.createBiquadFilter(); //filter, lowpass kinda makes the broader spectrum sawtooth waves hurt your ears less
    // filter.type = 'bandpass'
    // filter.frequency.setTargetAtTime(1200, 0, 0);

    var compressor = audioContext.createDynamicsCompressor(); //sets compressor node in a variable
    var analyser = audioContext.createAnalyser(); //Sets analyser node in a variable

    //TODO make the sounds nice at some point using custom waveform probably
    // var sineTerms = new Float32Array([0.6, 0.3, 0.3, 0.1, 0.05]);
    // var cosineTerms = new Float32Array([0.4, 0.4, 0.7, 0.4, 0 ]);
    // var customWaveform = context.createPeriodicWave(cosineTerms, sineTerms);


    //Add some notes

    for(var i = 0; i<maxNotes; i++){
      var note = createNote(0, 2, audioContext)
      // note.volume.connect(filter)
      note.volume.connect(compressor)
           
      notes.push(note)
    }


    // filter.connect(compressor);
    compressor.connect(master);
    master.connect(analyser);
    analyser.connect(audioContext.destination); //This actually outputs the sound


    //Divide by the frequency range in powers of to(octaves) scalar and also 12, for chromatic
    // var denominator = octaveSpan*12;
    // var scaleIndex = 0;
    // var scale = [2.0,2.0,1.0,2.0,2.0,2.0,1.0]

    // setInterval(function() {
    //   if (mute) {
    //     master.gain.value = 0;
    //   } else {
    //     master.gain.value = gainVal;
    //   }
    //   console.log(`scale index ${scaleIndex}`)
    //   aNote.setPhase((aNote.phase + (scale[scaleIndex]/denominator))%1.0)
    //   scaleIndex = (scaleIndex === (scale.length - 1)) ? 0 : scaleIndex + 1;
    // }, intervalTime);

    setUpVisualizer(analyser)
  }