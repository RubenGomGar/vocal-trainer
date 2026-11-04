// Canción sintética estéreo: voz (centro) con melodía, bajo (centro), acordes (L/R), batería.
export function synthSong({sr=44100,dur=24,seed=3,voiceGain=1,bassGain=.8,padGain=.6,drums=.25,key=57,center=false}={}){
  let s=seed;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};const gauss=()=>{let u=0;for(let i=0;i<6;i++)u+=rnd();return (u-3)/Math.sqrt(.5)};
  const N=Math.floor(sr*dur),L=new Float32Array(N),R=new Float32Array(N),truth=new Float32Array(N).fill(NaN);
  const scale=[0,2,4,5,7,9,11,12];
  // melodía: notas de 0.3–0.9 s con silencios
  const mel=[];let t=.5;while(t<dur-1){const d=.3+rnd()*.6;const q=key+12+scale[Math.floor(rnd()*scale.length)]-5;mel.push({t0:t,t1:t+d,q});t+=d+(rnd()<.25?.3+rnd()*.4:.02)}
  // progresión de acordes cada 2 s
  const prog=[[0,4,7],[9,12,16],[5,9,12],[7,11,14]];
  // voz
  {let ph=0,tNext=0,period=.004,amp=1;const F=[[730,90],[1090,110],[2440,170],[3400,250]];const src=new Float32Array(N);
   let mi=0;for(let i=0;i<N;i++){const tt=i/sr;while(mi<mel.length&&tt>mel[mi].t1)mi++;const n=mel[mi];
     if(n&&tt>=n.t0){const into=tt-n.t0;const prev=mi>0?mel[mi-1].q:n.q;const g=into<.04&&n.t0-mel[Math.max(0,mi-1)].t1<.05?prev+(n.q-prev)*into/.04:n.q;
       const m=g+(into>.25?.35*Math.sin(2*Math.PI*5.5*tt):0);truth[i]=g;const f=440*Math.pow(2,(m-69)/12);
       if(tt>=tNext){period=(1/f)*(1+.006*gauss());amp=1+.08*gauss();tNext+=period;if(tNext<tt)tNext=tt+period;ph=0}
       const u=ph/period;ph+=1/sr;let gg=0;if(u<.4)gg=.5*(1-Math.cos(Math.PI*u/.4));else if(u<.6)gg=Math.cos(Math.PI/2*(u-.4)/.2);
       const env=Math.min(1,into/.03,(n.t1-tt)/.03);src[i]=gg*amp*env}else{tNext=tt}}
   for(let i=N-1;i>0;i--)src[i]-=src[i-1];const out=new Float32Array(N);
   for(const [fc,bw] of F){const r=Math.exp(-Math.PI*bw/sr),th=2*Math.PI*fc/sr,a1=2*r*Math.cos(th),a2=-r*r,g=(1-r);let y1=0,y2=0;for(let i=0;i<N;i++){const y=g*src[i]+a1*y1+a2*y2;y2=y1;y1=y;out[i]+=y}}
   let pk=0;for(const v of out)pk=Math.max(pk,Math.abs(v));for(let i=0;i<N;i++){const v=out[i]/pk*.5*voiceGain;L[i]+=v;R[i]+=v}}
  // bajo: diente de sierra filtrado en la fundamental del acorde, octava 2
  {let ph=0,lp=0;for(let i=0;i<N;i++){const tt=i/sr;const ch=prog[Math.floor(tt/2)%4];const beat=(tt*2)%1;const q=key-12+ch[0]+(beat>.5?7:0);const f=440*Math.pow(2,(q-69)/12);
    ph=(ph+f/sr)%1;const v=2*ph-1;lp+=.08*(v-lp);const env=Math.exp(-3*((tt*2)%1));const o=lp*env*bassGain*.9;L[i]+=o;R[i]+=o}}
  // acordes: tres osciladores triangulares, abiertos en estéreo
  {const ph=[0,0,0];for(let i=0;i<N;i++){const tt=i/sr;const ch=prog[Math.floor(tt/2)%4];let l=0,r=0;ch.forEach((iv,k)=>{const f=440*Math.pow(2,(key+iv-69)/12)*(1+.002*k);ph[k]=(ph[k]+f/sr)%1;const v=(ph[k]<.5?4*ph[k]-1:3-4*ph[k])*.33*padGain;const pan=center?.5:[.15,.5,.85][k];l+=v*(1-pan)*1.4;r+=v*pan*1.4});L[i]+=l;R[i]+=r}}
  // batería: bombo y charles
  for(let i=0;i<N;i++){const tt=i/sr;const b=tt%.5;const kick=b<.12?Math.sin(2*Math.PI*(60-200*b)*b)*Math.exp(-b*30):0;const hh=((tt+.25)%.5)<.03?gauss()*.3*Math.exp(-((tt+.25)%.5)*120):0;L[i]+=(kick+hh*.8)*drums;R[i]+=(kick+hh*1.2)*drums}
  return{L,R,truth,sr,mel}}
