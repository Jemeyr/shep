


var lowestFreq = 128;//50; //Lowest outputted frequency (seperate from what is generated)
var highestFreq = 8192;//10000; //Highest outputted frequency (seperate from what is generated)

//calculated shit
//Ok basically we need to find out what frequency is logarithmically 1 Nth (For n oscillators) of the range from low to high
var logRange = Math.log(highestFreq) / Math.log(lowestFreq)



function getFadeInCutoff(oscAmt){
  return lowestFreq + Math.pow(lowestFreq, logRange/oscAmt)
}

function getFadeOutCutoff(oscAmt){
  return lowestFreq + Math.pow(lowestFreq, (logRange * (oscAmt - 1))/oscAmt)
}




//TODO TODO this uses a bunch of jankily far away state. Also the math seems wrong
//TODO this maps a "phase" to a frequency. Phases should basically map a 0-1 range to some number of octaves (2-4?) with a shepard tone wrapping such that 0 = 1 
function toFrequency(phase){
  return  lowestFreq + Math.pow(lowestFreq, logRange * (phase == 0 ? 0.0000001 : phase))
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
  note.volume.value = 1.0

  for (i = 0; i < oscAmt; i++) {
    osc = context.createOscillator();
    osc.type = 'triangle'
    
    gain = context.createGain()
    gain.gain.value = 1

    //each osc in a note has its own gain to fade in/out appropriately, and then a note overall volume
    osc.connect(gain)
    gain.connect(note.volume)

    //These notes aren't sorted out yet, we define a function to manage them and then call it later
    note.oscs[i] = osc
    note.gains[i] = gain
  }

  note.setVolume = function(newVolume){
    note.volume.value = newVolume;
  }

  note.setPhase = function(newPhase){
    this.phase = newPhase
    var oscAmt= note.oscs.length

    var fadeInCutoff = getFadeInCutoff(oscAmt); 
    var fadeOutCutoff = getFadeOutCutoff(oscAmt); 

    for (i = 0; i< oscAmt; i++){
      //split the phase spectrum by oscillator count, then add phase, which is really the offset and mod 1 to loop
      var frequency = toFrequency(((i/oscAmt) + newPhase) % 1)
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

  note.setPhase(phase)

  for (i = 0; i < oscAmt; i++) {  
    note.oscs[i].start(0)
  }

  return note
}

jQuery("document").ready(function($) {


  $('.btn-run').click(function() {

    /*Sets up buttons*/
    $('.button').addClass('btn-nope'); //Makes sure 'run' can't be clicked again
    $('.btn-mute').addClass('btn-mute-visible'); //Show the mute button
    $('.btn-mute').click(function() {
      $(this).toggleClass('disable');
    });

    //Sets up the initial audio context
    context = new AudioContext();

    //Config shit
    var oscAmt = 12; //Amount of oscillators (10 by default)
   
    var gainVal = 0.2; //Sets gain value. Keep low!

    var intervalTime = 25;//how often to update things



    var filter = filter = context.createBiquadFilter(); //filter, lowpass kinda makes the broader spectrum sawtooth waves hurt your ears less
    filter.type = 'bandpass'
    filter.frequency.setTargetAtTime(1200, 0, 0);

    var compressor = context.createDynamicsCompressor(); //sets compressor node in a variable
    var analyser = context.createAnalyser(); //Sets analyser node in a variable

    //TODO make the sounds nice at some point using custom waveform probably
    // var sineTerms = new Float32Array([0.6, 0.3, 0.3, 0.1, 0.05]);
    // var cosineTerms = new Float32Array([0.4, 0.4, 0.7, 0.4, 0 ]);
    // var customWaveform = context.createPeriodicWave(cosineTerms, sineTerms);

    var master = context.createGain();
    master.gain.value = gainVal;

    //Add some notes

    var aNote = createNote(0.01, 6, context)
    aNote.volume.connect(filter)

    var bNote = createNote(0.02, 6, context)
    bNote.volume.connect(filter)

    var cNote = createNote(aNote.phase + 0.4, 6, context)
    cNote.volume.connect(filter)


    filter.connect(compressor);
    compressor.connect(master);
    master.connect(analyser);
    analyser.connect(context.destination); //Connect compressor node to destination (usually speakers)

    setInterval(function() {
      if ($('.btn-mute').hasClass('disable')) {
        master.gain.value = 0;
      } else {
        master.gain.value = gainVal;
      }
      bNote.setPhase(bNote.phase + 0.0005)
      aNote.setPhase(aNote.phase + 0.999)
      cNote.setPhase(cNote.phase + 0.99999)

    }, intervalTime);

    /*Analyser*/

    //Setting up canvas
    var canvas = document.querySelector('.canvas');
    var WIDTH = canvas.width;
    var HEIGHT = canvas.height;
    var canvasCtx = canvas.getContext('2d');
    console.log(context);

    //Setting up analyser
    analyser.fftSize = 1024;//4096; meh
    var bufferLength = analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);
    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);


    //TODO the 0.9 and 1.2 are fudge factors taht seem to be needed but shouldn't be
    //scale the width and don't render empty triangles for frequencies we filter out 
    var analyserFrequencyScalar = (48000 / (2 * highestFreq));
    var barWidth = (WIDTH / bufferLength) * analyserFrequencyScalar * 0.9;
    var analyserLoopAmount = (bufferLength / analyserFrequencyScalar) * 1.2;
    var barMaxHeight = 260; //pixels
    function draw() {
      drawVisual = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = 'rgb(30,0,30)';
      // canvasCtx.setTransform(1, 0, 0, 1, 0, 0);

      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);


      for (i = 0; i < analyserLoopAmount; i++) {
        barHeight = dataArray[i] * (barMaxHeight / 255);
        canvasCtx.fillStyle = `rgb(${120-barHeight/2},${barHeight},0)`;

        canvasCtx.fillRect(barWidth * i, HEIGHT - barHeight, barWidth, barHeight);
      }

    };
    draw();

  }); //End click button

}); //End jQuery