

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
  return  lowestFreq * Math.pow(2, octaveSpan * phase);
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
    osc.type = 'sawtooth'
    
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
      var frequency = toFrequency((newPhase + ((i === 0 ? 0 : Math.log(i+1)) / Math.log(2))/octaveSpan) %1.0 );
      console.log(`Setting frequency(${i}) to ${frequency} [which is ${frequency / toFrequency((newPhase) % 1)}]`)
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

var mute = false;

function toggleMute(){
  mute = !mute;
}


function start(){
    document.getElementById('startButton').remove()
    document.getElementById('muteButton').className='btn-mute-visible'

    //Sets up the initial audio context
    context = new AudioContext();

    //Config shit
    var gainVal = 0.2; //Sets gain value. Keep low!

    var intervalTime = 500;//how often to update things



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

    var aNote = createNote(0, 16, context)
    aNote.volume.connect(filter)



    filter.connect(compressor);
    compressor.connect(master);
    master.connect(analyser);
    analyser.connect(context.destination); //Connect compressor node to destination (usually speakers)


    //Divide by the frequency range in powers of to(octaves) scalar and also 12, for chromatic
    var denominator = octaveSpan*12;
    var scaleIndex = 0;
    var scale = [2.0,2.0,1.0,2.0,2.0,2.0,1.0]

    setInterval(function() {
      if (mute) {
        master.gain.value = 0;
      } else {
        master.gain.value = gainVal;
      }
      console.log(`scale index ${scaleIndex}`)
      aNote.setPhase((aNote.phase + (scale[scaleIndex]/denominator))%1.0)
      scaleIndex = (scaleIndex === (scale.length - 1)) ? 0 : scaleIndex + 1;
    }, intervalTime);

    /*Analyser*/

    //Setting up canvas
    var canvas = document.querySelector('.canvas');
    var WIDTH = canvas.width;
    var HEIGHT = canvas.height;
    var canvasCtx = canvas.getContext('2d');
    console.log(context);

    //Setting up analyser
    analyser.fftSize = 1024;//meh
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

  }