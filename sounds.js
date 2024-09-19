
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


//I've trashed the idea of the frequency span being octaves so this being based on A440 is just for fun
var lowestFreq = 55;
var highestFreq = 2*14080;

//This is basically the range in octaves
var logRange = Math.log2(highestFreq/lowestFreq)

//This is functionally in octaves how much of the range we want to fade out over
var fadeSpan = logRange/3; //fade in, max, fade out in equal parts?
var lowCutoff = lowestFreq * Math.pow(2,fadeSpan)
var highCutoff = highestFreq / Math.pow(2,fadeSpan)


//This appears to be needed because using Number.MIN_VALUE drops below some audiocontext epsilon for exponential scalars or something
const EPSILON = 0.00000000001;



//seconds to change volume, sure
var volumeAttack = 0.1;


//TODO TODO this uses a bunch of jankily far away state. Also the math seems wrong
//TODO this maps a "phase" to a frequency. Phases should basically map a 0-1 range to some number of octaves (2-4?) with a shepard tone wrapping such that 0 = 1
function toFrequency(phase, offset){
  //original function spans oddly?
  //TODO this was using octavespan
  var offsetPhase = (phase % (1/logRange) + (offset/logRange)) % 1.0
  console.log(`Math ${JSON.stringify({phase, offset, offsetPhase})}`)
  //This basically makes the phase loop over the span 
  return lowestFreq * Math.pow(2, logRange * offsetPhase)
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
    //This is set later anyway
    var gainAmount = 1.0;

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

    //Yolo frequencies to just octaves of the original?
    //TODO this loop has to work with phase?
    var frequency = toFrequency(newPhase, 0)


    for (i = 0; i< oscAmt; i++){
      //Kinda janky to add offset to phase and then ignore it but meh
      this.oscs[i].frequency.value = frequency; //Apply new frequency to oscillator.
      frequency *= 2

      //Default to no volume
      var gainScalar = 0.0;
      //This is basically how many octaves of the range on each end we want to fade out over

      if(frequency < lowCutoff){
        gainScalar = Math.log2(frequency/lowestFreq)/fadeSpan;
      } else if(frequency < highCutoff){
        gainScalar = 1.0;
      
      } else if(frequency < highestFreq) {
        gainScalar = 0-(Math.log2(frequency/highestFreq)/fadeSpan);
      }
      console.log(`Set ${i} to ${frequency} at gain ${gainScalar}`)


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
  '12tet': {
    x: 1,
    y: 2,
    d: 12,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '19edo A': {
    x: 6,
    y: 11,
    d: 19,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '19edo B': {
    x: 5,
    y: 9,
    d: 19,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '19edo C': {
    x: 3,
    y: 7,
    d: 19,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  'ratio A': {
    x: Math.log2(5/4),
    y: Math.log2(3/2),
    d: 1,
    info: function(){
      return `xScalar: ${Math.pow(2,this.x)}\nyScalar: ${Math.pow(2, this.y)}`
    }
  },
  'ratio B': {
    x: Math.log2(5/4),
    y: Math.log2(4/3),
    d: 1,
    info: function(){
      return `xScalar: ${Math.pow(2,this.x)}\nyScalar: ${Math.pow(2, this.y)}`
    }
  },
  'ratio C': {
    x: Math.log2(3/2),
    y: Math.log2(4/3),
    d: 1,
    info: function(){
      return `xScalar: ${Math.pow(2,this.x)}\nyScalar: ${Math.pow(2, this.y)}`
    }
  },
  'thirds': {
    x: Math.log2(81/64),
    y: 1/3,
    d: 1,
    info: function(){
      return `xScalar: JI major 3rd\nyScalar: ET major 3rd`
    }
  },
  '5edo': {
    x: 1,
    y: 2,
    d: 5,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '7edo A': {
    x: 1,
    y: 2,
    d: 7,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '7edo B': {
    x: 2,
    y: 3,
    d: 7,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '7edo B': {
    x: 2,
    y: 3,
    d: 7,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  '14edo': {
    x: 1,
    y: 2,
    d: 14,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
  'pi edo': {
    x: 1,
    y: 2,
    d: 3.141592,
    info: function(){
      return `xScalar: ${this.x}\nyScalar: ${this.y}\nedo: ${this.d}`
    }
  },
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
    note.setPhase((box.x * scalars.x + box.y * scalars.y)/ (logRange * scalars.d))

  })
  for(var i = 0; i<maxNotes; i++){
    if(!active.includes(i)){
      notes[i].setVolume(0)
    }
  }

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
    console.log(`logrange ${logRange}`)
    for(var i = 0; i<maxNotes; i++){
      var note = createNote(0, Math.floor(logRange), audioContext)
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