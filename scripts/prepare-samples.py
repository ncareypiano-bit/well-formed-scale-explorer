"""Build the small CC0 Versilian sample bank. Requires Python 3 and NumPy.
Downloads original recordings to a temporary cache, never into the asset directory.
"""
import argparse, concurrent.futures, hashlib, json, math, subprocess, tempfile, wave
from pathlib import Path
from urllib.parse import quote
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets' / 'samples'
VC = 'https://raw.githubusercontent.com/sgossner/VCSL/sfz/'
VS = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/'

def source_specs():
    specs = []
    def add(bank, key, path, expected, seconds, loop=False, base=VC):
        specs.append(dict(bank=bank, key=key, source=base+quote(path,safe='/'), expectedHz=expected, seconds=seconds, loop=loop))
    for octave, seconds in zip(range(2,8), [7,6,5,4,2.5,1.5]):
        add('piano',f'c{octave+1}',f'Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C{octave}_v2_rr1_Player.wav',440*2**((12*(octave+2)-69)/12),seconds)
    for note, octave in [('F',1),('C',2),('B',2),('F',3),('C',4),('B',4),('F',5),('C',6)]:
        semitone={'C':0,'F':5,'B':11}[note]
        add('marimba',f'{note.lower()}{octave+1}',f'Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_{note}{octave}_med_01.wav',440*2**((12*(octave+2)+semitone-69)/12),4)
    for octave in range(1,7):
        add('organ',f'c{octave+1}',f'Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/NT5_Man3Quiet_C{octave}_rr1.wav',440*2**((12*(octave+2)-69)/12),3.2,True)
    for octave in range(2,6):
        add('clarinet',f'd{octave+1}',f'Woodwinds/Clarinet/susLong/DCClar_susLong_D{octave}_v2_rr1_sum.wav',440*2**((12*(octave+2)+2-69)/12),3.2,True,VS)
    return specs

def load(path):
    with wave.open(str(path),'rb') as w:
        fs, channels, width = w.getframerate(),w.getnchannels(),w.getsampwidth()
        raw=w.readframes(w.getnframes())
    if width==2: x=np.frombuffer(raw,'<i2').astype(float)/32768
    elif width==3:
        b=np.frombuffer(raw,np.uint8).reshape(-1,3).astype(np.int32)
        v=b[:,0]+(b[:,1]<<8)+(b[:,2]<<16)
        x=((v^(1<<23))-(1<<23))/8388608
    else: raise ValueError(f'Unsupported sample format: {path}')
    return x.reshape(-1,channels).mean(axis=1),fs

def pitch(x,fs,expected):
    size=2**19
    s=np.abs(np.fft.rfft((x-x.mean())*np.hanning(len(x)),size))
    lo=int(expected*2**(-90/1200)*size/fs);hi=int(expected*2**(90/1200)*size/fs)
    i=lo+int(np.argmax(s[lo:hi+1]))
    a,b,c=np.log(np.maximum(s[i-1:i+2],1e-20))
    denominator=a-2*b+c
    delta=.5*(a-c)/denominator if abs(denominator)>1e-12 else 0
    return float((i+delta)*fs/size)

def prepare(spec,cache):
    raw=cache/(spec['bank']+'-'+spec['key']+'.wav')
    if not raw.exists():
        subprocess.run(['curl','--fail','--silent','--show-error',spec['source'],'-o',str(raw)],check=True)
    x,fs=load(raw)
    # Trim recording lead-in; keep 5 ms before the first audible attack.
    block=max(1,int(.005*fs));rms=np.sqrt(np.mean(x[:len(x)//block*block].reshape(-1,block)**2,axis=1))
    audible=np.flatnonzero(rms>max(rms)*.035)
    trim=max(0,int(audible[0])*block-int(.005*fs)) if len(audible) else 0
    x=x[trim:]
    estimates=[]
    starts = np.linspace(.08,.35,5) if spec['bank'] in ('piano','marimba') else np.linspace(.22,min(1.4,max(.22,len(x)/fs-.5)),5)
    for start in starts:
        window=x[int(start*fs):int((start+.45)*fs)]
        if np.sqrt(np.mean(window**2)) > max(1e-9,float(np.max(np.abs(x)))*.001):
            estimates.append(pitch(window,fs,spec['expectedHz']))
    if not estimates: raise ValueError('No stable pitch window: '+str(spec))
    root=float(np.median(estimates))
    if not math.isfinite(root) or abs(1200*math.log2(root/spec['expectedHz']))>75: raise ValueError('Unexpected root pitch: '+str(spec))
    x=x[:min(len(x),int(spec['seconds']*fs))].copy()
    sustain=x[int(.2*fs):min(len(x),int(.8*fs))]
    level=float(np.sqrt(np.mean(sustain**2)))
    x*=min(.085/max(level,1e-9),.72/max(np.max(np.abs(x)),1e-9))
    entry=dict(url=f'./assets/samples/{spec["bank"]}/{spec["key"]}.wav',rootHz=root)
    seam=None
    if spec['loop']:
        # Align a short crossfade approximately in phase, then join to its continuation.
        start=int(.85*fs);fade=int(.055*fs);ideal=min(int(2.9*fs),len(x)-int(.05*fs))
        radius=max(2,round(fs/root))
        reference=x[start:start+fade]
        candidates=range(max(start+2*fade,ideal-radius),min(len(x),ideal+radius))
        end=min(candidates,key=lambda e:float(np.mean((x[e-fade:e]-reference)**2)))
        w=np.linspace(0,1,fade)
        x[end-fade:end]=(1-w)*x[end-fade:end]+w*reference
        x=x[:end]
        entry.update(loopStart=(start+fade)/fs,loopEnd=end/fs)
        seam=float(abs(x[-1]-x[start+fade]))
    else:
        fade=min(int(.10*fs),len(x)//4)
        x[-fade:]*=np.cos(np.linspace(0,np.pi/2,fade))**2
    x[:min(64,len(x))]*=np.linspace(0,1,min(64,len(x)))
    dest=ROOT/entry['url'][2:];dest.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(dest),'wb') as w:
        w.setparams((1,2,fs,len(x),'NONE','not compressed'))
        w.writeframes(np.round(np.clip(x,-.99,.99)*32767).astype('<i2').tobytes())
    entry['duration']=len(x)/fs
    audit={**spec,**entry,'sourceSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'assetSha256':hashlib.sha256(dest.read_bytes()).hexdigest(),
           'rootOffsetCents':1200*math.log2(root/spec['expectedHz']),'sourcePitchSpanCents':1200*math.log2(max(estimates)/min(estimates)),
           'trimmedSeconds':trim/fs,'seamStep':seam,'bytes':dest.stat().st_size}
    print(spec['bank'],spec['key'],round(root,3),'Hz',dest.stat().st_size,'bytes',flush=True)
    return spec['bank'],entry,audit

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-dir',type=Path,default=Path(tempfile.gettempdir())/'wfse-versilian-sources');args=parser.parse_args()
    args.source_dir.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(lambda spec:prepare(spec,args.source_dir),source_specs()))
    banks={name:dict(name=label,release=release,sustained=sustained,samples=[]) for name,label,release,sustained in [
        ('piano','Piano',.13,False),('marimba','Marimba',.20,False),('organ','Pipe organ',.025,True),('clarinet','Clarinet',.045,True)]}
    for name,entry,audit in results:banks[name]['samples'].append(entry)
    for bank in banks.values():bank['samples'].sort(key=lambda entry:entry['rootHz'])
    (ROOT/'sample-bank.js').write_text('// CC0 Versilian recordings. Generated by scripts/prepare-samples.py; see assets/samples/README.md.\nexport const SAMPLE_BANKS = '+json.dumps(banks,indent=2)+';\n')
    (ASSETS/'sources.json').write_text(json.dumps([audit for _,_,audit in results],indent=2)+'\n')
    print('Total assets:',sum(audit['bytes'] for _,_,audit in results),'bytes',flush=True)

if __name__=='__main__':main()
