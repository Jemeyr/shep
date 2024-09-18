
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
var highestFreq = 3520;//A7
var octaveSpan = 5; //wait this was 6 = A2 -> A8 now its not a valid multiple :/
//This appears to be needed because using Number.MIN_VALUE drops below some audiocontext epsilon for exponential scalars or something
const EPSILON = 0.00000000001;

//calculated shit
//Ok basically we need to find out what frequency is logarithmically 1 Nth (For n oscillators) of the range from low to high
var logRange = Math.log(highestFreq) / Math.log(lowestFreq)

//seconds to change volume, sure
var volumeAttack = 0.1;


//TODO check these are not borked and reenable eventually
function getFadeInCutoff(oscAmt){
  return highestFreq;//lowestFreq + Math.pow(lowestFreq, logRange/oscAmt)
}

function getFadeOutCutoff(oscAmt){
  return lowestFreq// + Math.pow(lowestFreq, (logRange * (oscAmt - 1))/oscAmt)
}


//TODO TODO this uses a bunch of jankily far away state. Also the math seems wrong
//TODO this maps a "phase" to a frequency. Phases should basically map a 0-1 range to some number of octaves (2-4?) with a shepard tone wrapping such that 0 = 1
function toFrequency(phase){
  //Ok basically an octave is 2x frequency, so if we declare our ranges on frequencies as a range of 6, then that is the valid exponent our phase maps to?
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
  note.gainAmounts = []
  note.volume = context.createGain()

  //Start muted
  note.volume.gain.value = 0.0

  for (i = 0; i < oscAmt; i++) {
    var osc = context.createOscillator();
    osc.type = 'sine'
    
    var gain = context.createGain()
    var gainAmount = Math.pow((1.0 - (i/(oscAmt + 1))),8);

    gain.gain.value = gainAmount

    //each osc in a note has its own gain to fade in/out appropriately, and then a note overall volume
    osc.connect(gain)
    gain.connect(note.volume)

    //These notes aren't sorted out yet, we define a function to manage them and then call it later
    note.oscs[i] = osc
    note.gains[i] = gain
    //Kinda janky but gainAmount is for the oscillator, so if we have 3 oscillators for a note, the higher ones will be less loud?
    note.gainAmounts[i] = gainAmount
  }

  note.setVolume = function(newVolume){
    if(this.volume.gain.value == newVolume){
      return;
    }
    this.volume.gain.exponentialRampToValueAtTime(newVolume < EPSILON ? EPSILON : newVolume, audioContext.currentTime + volumeAttack);
  }

  note.setPhase = function(newPhase){
    this.phase = newPhase
    var oscAmt= note.oscs.length

    for (i = 0; i< oscAmt; i++){
      //TODO the way we calculate these is kinda janky, In theory this should produce a compound note frequency which has energy across the spectrum we care about, so
      //TODO that the shepard tone effect can apply to it.
      //TODO it's probably better to just make the oscillator approximately even across the frequency spectrum and filter out the spectrum

      var frequency = toFrequency((newPhase + ((Math.log(i+1) / Math.log(2))/octaveSpan)) % 1.0 );
      this.oscs[i].frequency.value = frequency; //Apply new frequency to oscillator.

      //Rejanked, clip to our frequency range, in the first/last octave of the range scale linearly for now
      //Basically a bad bandpass filter?

      //Default to no volume
      var gainScalar = 0.0;
      if(frequency < lowestFreq*2){
        gainScalar = ((frequency-lowestFreq) / lowestFreq);
        
      } else if(frequency < highestFreq/2){
        gainScalar = 1.0;
      
      } else if(frequency < highestFreq) {
        gainScalar = (highestFreq - frequency)/(highestFreq/2);
      }

      var gain = gainScalar * this.gainAmounts[i]
      this.gains[i].gain.exponentialRampToValueAtTime(gain < EPSILON  ? EPSILON : gain,volumeAttack);
      
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
var gridSize = 10; //The NxN grid to make
var squares = [...new Array(gridSize)].map((a,i) => [...new Array(gridSize)].map((a,i) => {return {selected: false};}));
var gridContext;
var maxNotes = 8;
//Hold list of coords instead of counts to scale up to infinite squares in future
var currentlySelected = [];

//Scalars, the x/y are the scalars for the grids. These scalars are for a power of 2 multiple so x=6, d=19 is 6 19ths of an octave and x = log2(5/4), d=1 is a ratio of 5/4 of output frequency
var gridScalars = {
  edo19: {
    x: 6,
    y: 11,
    d: 19,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  'edo19 2': {
    x: 5,
    y: 9,
    d: 19,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  'edo19 3': {
    x: 3,
    y: 7,
    d: 19,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  ratio: {
    x: Math.log2(5/4),
    y: Math.log2(3/2),
    d: 1,
    info: function(){
      return `xScalar: ${Math.pow(2,this.x)}\nyScalar: ${Math.pow(2, this.y)}`
    }
  },
  'ratio 2': {
    x: Math.log2(5/4),
    y: Math.log2(4/3),
    d: 1,
    info: function(){
      return `xScalar: ${Math.pow(2,this.x)}\nyScalar: ${Math.pow(2, this.y)}`
    }
  },
  'ratio 3': {
    x: Math.log2(3/2),
    y: Math.log2(4/3),
    d: 1,
    info: function(){
      return `xScalar: ${Math.pow(2,this.x)}\nyScalar: ${Math.pow(2, this.y)}`
    }
  },
  mix: {
    x: Math.log2(81/64),
    y: 1/3,
    d: 1,
    info: function(){
      return `xScalar: JI major 3rd\nyScalar: ET major 3rd`
    }
  }
}
var gridScalarMode = Object.keys(gridScalars)[0];



function toggleMode(){
  var scalarTypes = Object.keys(gridScalars);
  gridScalarMode = scalarTypes[(scalarTypes.indexOf(gridScalarMode) + 1) % scalarTypes.length]

  //clear everything
  squares = [...new Array(gridSize)].map((a,i) => [...new Array(gridSize)].map((a,i) => {return {selected: false};}));
  currentlySelected = [];
  updateNotes();
  drawGrid();

  document.getElementById("modeButton").innerHTML=`Mode: ${gridScalarMode}`;
  updateInfoBox()
}




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
  var active = []
  currentlySelected.forEach(function(box, i) {
    active.push(box.noteIndex);
    var note = notes[box.noteIndex]
    note.setVolume(1);
    var scalars = gridScalars[gridScalarMode];
    note.setPhase((box.x * scalars.x + box.y * scalars.y)/ (octaveSpan * scalars.d))

  })
  for(var i = 0; i<maxNotes; i++){
    if(!active.includes(i)){
      notes[i].setVolume(0)
    }
  }

  // 1/(octaveSpan*12) -> semitone in 12 tet
  //TODO this is cool in 19edo but I should also do the math so you can have each jump in the grid be an integer ratio in frequencies
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

function updateInfoBox(){
  var element = document.getElementById('infoBox').innerHTML = gridScalars[gridScalarMode].info();

}


function toggleMute(){
  mute = !mute;
  if(master){
      if (mute) {
        master.gain.exponentialRampToValueAtTime(EPSILON, audioContext.currentTime);
      } else {
        master.gain.exponentialRampToValueAtTime(gainVal, audioContext.currentTime + volumeAttack);
      }
      document.getElementById('muteButton').innerHTML=mute ? 'Unmute' : 'Mute'

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
      var removeIndex = currentlySelected.findIndex(item => item.x == x && item.y == y)
      currentlySelected.splice(removeIndex, 1)
    } else {
      //TODO Janky object pool for notes. Find any unused index and if not default to lenght
      var noteIndex;
      for(var i = 0; i < currentlySelected.length; i++){
        if(currentlySelected.findIndex(item => item.noteIndex == i) < 0){
          noteIndex = i;
          break;
        }
      }
      if(!noteIndex && noteIndex != 0){
        noteIndex = currentlySelected.length
      }
      
      currentlySelected.push({x,y,noteIndex})
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
    // console.log('setting grid box size')
    gridBoxX = gridX/gridSize;
    gridBoxY = gridY/gridSize;
    gridContext = grid.getContext('2d');
    drawGrid()
}

function start(){
    document.getElementById('startButton').remove()
    document.getElementById('muteButton').className='btn-visible'
    var modeButtonElement = document.getElementById('modeButton')
    modeButtonElement.className='btn-visible'
    modeButtonElement.innerHTML=`Mode: ${gridScalarMode}`;
    
    document.getElementById('infoBox').className='info-box-visible'
    updateInfoBox()



    audioContext = new AudioContext();
    master = audioContext.createGain();
    master.gain.value = gainVal;



    var filter = filter = audioContext.createBiquadFilter(); //filter, lowpass kinda makes the broader spectrum sawtooth waves hurt your ears less
    filter.type = 'bandpass'
    filter.frequency.setTargetAtTime(1200, 0, 0);

    var compressor = audioContext.createDynamicsCompressor(); //sets compressor node in a variable
    var analyser = audioContext.createAnalyser(); //Sets analyser node in a variable

    //TODO make the sounds nice at some point using custom waveform probably
    // var sineTerms = new Float32Array([0.6, 0.3, 0.3, 0.1, 0.05]);
    // var cosineTerms = new Float32Array([0.4, 0.4, 0.7, 0.4, 0 ]);
    // var customWaveform = context.createPeriodicWave(cosineTerms, sineTerms);


    //Add some notes

    for(var i = 0; i<maxNotes; i++){
      var note = createNote(0, 3, audioContext)
      note.volume.connect(filter)
      // note.volume.connect(compressor)
           
      notes.push(note)
    }


    filter.connect(compressor);
    compressor.connect(master);
    master.connect(analyser);
    analyser.connect(audioContext.destination); //This actually outputs the sound

    setUpVisualizer(analyser)
  }