// Voz sintética realista: tren glotal con jitter/shimmer, formantes, aspiración, deriva lenta, vibrato opcional, ruido de micro.
export function synthVoice({sr=48000,dur=3,m=57,vib=0,vibRate=5.5,drift=12,jitter=.006,shimmer=.08,snr=25,breath=.04,vowel='a',lowcut=0,seed=1}){
  let s=seed;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};const gauss=()=>{let u=0;for(let i=0;i<6;i++)u+=rnd();return (u-3)/Math.sqrt(.5)};
  const N=Math.floor(sr*dur),x=new Float32Array(N),truth=new Float32Array(N),center=new Float32Array(N);
  const F={a:[[730,90],[1090,110],[2440,170],[3400,250]],u:[[300,70],[870,90],[2240,160],[3300,250]],i:[[270,60],[2290,120],[3010,170],[3600,250]]}[vowel];
  // fuente: pulsos glotales (Rosenberg) → resonadores
  let ph=0,dr=0,period=0,pulseAmp=1,tNext=0;const src=new Float32Array(N);
  for(let i=0;i<N;i++){const t=i/sr;if(i%480===0){dr+= gauss()*drift*.05;dr*=.985}
    const mm=m+dr/100+(vib?vib/200*Math.sin(2*Math.PI*vibRate*t):0);truth[i]=mm;center[i]=m+dr/100;const f=440*Math.pow(2,(mm-69)/12);
    if(t>=tNext){period=(1/f)*(1+jitter*gauss());pulseAmp=1+shimmer*gauss();tNext=t+period;ph=0}
    const u=ph/period;ph+=1/sr;const oq=.6;let g=0;if(u<oq*.67)g=.5*(1-Math.cos(Math.PI*u/(oq*.67)));else if(u<oq)g=Math.cos(Math.PI/2*(u-oq*.67)/(oq*.33));
    src[i]=g*pulseAmp}
  // derivada (radiación labios)
  for(let i=N-1;i>0;i--)src[i]=src[i]-src[i-1];
  const out=new Float32Array(N);
  for(const [fc,bw] of F){const r=Math.exp(-Math.PI*bw/sr),th=2*Math.PI*fc/sr,a1=2*r*Math.cos(th),a2=-r*r,g=(1-r);let y1=0,y2=0;
    for(let i=0;i<N;i++){const y=g*src[i]+a1*y1+a2*y2;y2=y1;y1=y;out[i]+=y}}
  let pk=0;for(let i=0;i<N;i++)pk=Math.max(pk,Math.abs(out[i]));
  let rmsS=0;for(let i=0;i<N;i++){out[i]/=pk;rmsS+=out[i]*out[i]}rmsS=Math.sqrt(rmsS/N);
  const nAmp=rmsS/Math.pow(10,snr/20);
  for(let i=0;i<N;i++)x[i]=.3*(out[i]+breath*gauss()*Math.abs(out[i])+nAmp*gauss());
  if(lowcut){// micro de móvil: paso alto 2º orden
    const w=Math.tan(Math.PI*lowcut/sr),k=1/(1+Math.SQRT2*w+w*w);const b0=k,b1=-2*k,b2=k,a1=2*(w*w-1)*k,a2=(1-Math.SQRT2*w+w*w)*k;let x1=0,x2=0,y1=0,y2=0;
    for(let i=0;i<N;i++){const y=b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=x[i];y2=y1;y1=y;x[i]=y}}
  return{x,truth,center,sr}}
