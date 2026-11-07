import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { AudioEngine } from './audio.js';
import { SAMPLE_BANKS } from './sample-bank.js';

const param = () => {
  const p = {value:0, events:[]};
  for (const name of ['setValueAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime','setTargetAtTime']) p[name] = (value,time) => {p.value=value;p.events.push({name,value,time});};
  p.cancelScheduledValues = () => {}; return p;
};
class Context {
  constructor() {this.currentTime=10;this.state='running';this.destination={};this.sources=[];}
  createGain() { const node={gain:param(),connect:()=>node,disconnect(){}};return node; }
  source() {
    const node={frequency:param(),playbackRate:param(),stops:[],connect:()=>node,disconnect(){},start(time){this.startTime=time;},stop(time){this.stops.push(time);}};
    this.sources.push(node);return node;
  }
  createOscillator(){return this.source();}
  createBufferSource(){return this.source();}
  async decodeAudioData(data){return {data};}
}
globalThis.AudioContext = Context;
const fetcher = async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});

test('volume applies before startup; Stop cancels all transient, held and future notes', async () => {
  const audio=new AudioEngine();audio.setVolume(.25);await audio.resume();
  assert.equal(audio.master.gain.value,.25);
  audio.playTransient('click',[220],{timbre:'sine',duration:.75});
  audio.startSustainedNote('key',[330],{timbre:'sine'});
  assert.equal(audio.playbackNodes.length,2);
  assert.equal(audio.activeNotes.size,1);
  audio.stopAll();
  assert.equal(audio.playbackNodes.length,0);assert.equal(audio.activeNotes.size,0);
  assert.ok(audio.context.sources.every(source=>source.stops.at(-1)<=10.1));
  audio.schedulePlayback([{frequency:440},{frequency:660}],{timbre:'sine',interval:.375});
  audio.stopAll();
  assert.ok(audio.context.sources.every(source=>source.stops.at(-1)<=10.1));
});

test('banks load lazily, share concurrent requests, cache success and retry failure', async () => {
  let requests=0;let fail=true;
  const audio=new AudioEngine({fetcher:async()=>{requests++;return {ok:!fail,arrayBuffer:async()=>new ArrayBuffer(4)};}});
  await audio.ensureInstrument('sine');assert.equal(requests,0);
  await assert.rejects(audio.ensureInstrument('piano'),/Could not load/);
  fail=false;requests=0;
  await Promise.all([audio.ensureInstrument('piano'),audio.ensureInstrument('piano')]);
  assert.equal(requests,SAMPLE_BANKS.piano.samples.length);
  await audio.ensureInstrument('piano');assert.equal(requests,SAMPLE_BANKS.piano.samples.length);
  assert.equal(audio.instruments.size,1);
});

test('all sampled voices use continuous calibrated rates; only organ and clarinet loop', async () => {
  const audio=new AudioEngine({fetcher});
  for (const timbre of Object.keys(SAMPLE_BANKS)) {
    await audio.ensureInstrument(timbre);
    const frequency=440*2**(17.25/1200);
    audio.startSustainedNote(timbre,[frequency],{timbre});
    const source=audio.context.sources.at(-1);
    const sample=SAMPLE_BANKS[timbre].samples.reduce((best,item)=>Math.abs(Math.log2(frequency/item.rootHz))<Math.abs(Math.log2(frequency/best.rootHz))?item:best);
    assert.equal(source.playbackRate.value,frequency/sample.rootHz);
    assert.equal(source.loop,['organ','clarinet'].includes(timbre));
    assert.equal(source.stops.length,0);
    if(source.loop)assert.ok(source.loopEnd>source.loopStart);
    audio.stopSustainedNote(timbre);assert.equal(source.stops.length,1);
  }
  audio.stopAll();
});

test('cycle gates reach the following beat and audio starts are scheduled on the context clock', async () => {
  const audio=new AudioEngine();await audio.resume();
  audio.schedulePlayback([{frequency:440},{frequency:441}],{timbre:'sine',interval:.375});
  const [a,b]=audio.context.sources;
  assert.equal(a.startTime,10.03);assert.equal(b.startTime,10.405);
  assert.equal(a.frequency.value,440);assert.equal(b.frequency.value,441);
  const events=audio.playbackNodes[0].masterGain.gain.events;
  const release=events.find(event=>event.name==='exponentialRampToValueAtTime');
  assert.ok(release.time>b.startTime);
  assert.ok(events.some(event=>event.name==='setValueAtTime'&&event.time===b.startTime&&event.value>.01));
  audio.stopAll();
});

test('every shipped sample has valid PCM, finite pitch, intact source metadata and safe loop bounds', () => {
  const audits=JSON.parse(fs.readFileSync(new URL('./assets/samples/sources.json',import.meta.url)));
  assert.equal(audits.length,24);
  for(const [name,bank] of Object.entries(SAMPLE_BANKS))for(const sample of bank.samples){
    assert.ok(Number.isFinite(sample.rootHz)&&sample.rootHz>0);
    const data=fs.readFileSync(new URL(sample.url,import.meta.url));
    assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');
    assert.equal(data.readUInt16LE(22),1);assert.equal(data.readUInt16LE(34),16);
    const audit=audits.find(item=>item.url===sample.url);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'),audit.assetSha256);
    if(bank.sustained){assert.ok(sample.loopStart>0&&sample.loopEnd<=sample.duration);assert.ok(audit.seamStep<.1,`${name} loop seam`);}
  }
});


test('sampled chords retain earlier voices when another note starts or releases', async () => {
  const audio=new AudioEngine({fetcher});await audio.ensureInstrument('clarinet');
  audio.startSustainedNote('a',[220],{timbre:'clarinet'});
  const first=audio.activeNotes.get('a').oscillators[0];
  audio.startSustainedNote('b',[275],{timbre:'clarinet'});
  audio.startSustainedNote('c',[330],{timbre:'clarinet'});
  assert.equal(audio.activeNotes.size,3);assert.equal(first.stops.length,0);
  audio.stopSustainedNote('b');assert.equal(audio.activeNotes.size,2);
  assert.equal(first.stops.length,0);audio.stopAll();
});

test('quick mouse notes can ring to a minimum gate while held notes release normally', async () => {
  const audio=new AudioEngine();await audio.resume();
  audio.startSustainedNote('mouse',[220],{timbre:'sine'});
  const a=audio.activeNotes.get('mouse').oscillators[0];
  audio.context.currentTime=10.01;
  audio.stopSustainedNote('mouse',{minimumDuration:.375});
  assert.ok(a.stops[0]>10.375);
  audio.startSustainedNote('mouse',[275],{timbre:'sine'});
  const b=audio.activeNotes.get('mouse').oscillators[0];
  assert.equal(a.stops.length,1);assert.equal(b.stops.length,0);
  audio.context.currentTime=11;
  audio.stopSustainedNote('mouse',{minimumDuration:.375});
  assert.ok(b.stops[0]<11.1);
  audio.stopAll();
});
