import icons from './icons.json' with {type:'json'};
import {createLoadingAssembly} from './loading-assembly.js';

(() => {
  const root=document.documentElement,loader=document.getElementById('introLoader');
  if(!loader){root.classList.remove('intro-loading');return;}
  const main=document.querySelector('main'),label=loader.querySelector('[data-loading-percent]');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const icon=icons[Math.floor(Math.random()*icons.length)];
  const assembly=createLoadingAssembly(loader.querySelector('.intro-loader-field'),icon,reducedMotion);
  const smoothScroll=typeof lenis!=='undefined'?lenis:null;
  const resumeScroll=smoothScroll&&!smoothScroll.isStopped,wasInert=main.inert;
  let progress=0,phase='loading',watchdog;
  main.inert=true;main.setAttribute('aria-busy','true');smoothScroll?.stop();

  function blockScroll(event){
    if(phase==='done')return;
    if(event.type==='keydown'&&![' ','ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopImmediatePropagation();
  }
  for(const type of ['wheel','touchmove','keydown'])window.addEventListener(type,blockScroll,{capture:true,passive:false});
  function release(){
    const lockedWidth=main.clientWidth;
    phase='done';loader.hidden=true;main.inert=wasInert;main.setAttribute('aria-busy','false');
    root.classList.remove('intro-loading','intro-revealing');
    // The legacy poster and the 3D camera must share the unlocked viewport too.
    if(main.clientWidth!==lockedWidth)window.dispatchEvent(new Event('resize'));
    for(const type of ['wheel','touchmove','keydown'])window.removeEventListener(type,blockScroll,true);
    window.removeEventListener('error',scriptError,true);
    if(resumeScroll)smoothScroll.start();
  }
  function paint(value){
    progress=value;
    loader.setAttribute('aria-valuenow',String(value));
    loader.setAttribute('aria-valuetext',`${value}% 로딩`);label.textContent=`${value}%`;
  }
  function finish(failed=false){
    if(phase!=='loading')return;
    phase=failed?'fallback':'finishing';clearTimeout(watchdog);
    function reveal(){
      phase='revealing';loader.classList.add('is-leaving');
      root.classList.add('intro-revealing');root.classList.remove('intro-loading');
      window.dispatchEvent(new Event('main-intro-reveal'));
      setTimeout(release,reducedMotion.matches?160:1700);
    }
    if(failed){assembly.stop();reveal();return;}
    assembly.finish(()=>{
      paint(100);
      setTimeout(reveal,reducedMotion.matches||document.hidden?0:220);
    });
  }
  function armWatchdog(){
    clearTimeout(watchdog);
    watchdog=setTimeout(()=>{if(document.hidden)armWatchdog();else fail();},60000);
  }
  function fail(){
    if(!window.heroNebula){
      if(window.MainIntro){window.MainIntro.complete=true;window.MainIntro.progress=1;}
      document.body.classList.remove('intro-before-main');document.body.classList.add('intro-unavailable');
      window.dispatchEvent(new CustomEvent('main-intro-handoff',{detail:{complete:true}}));
    }
    finish(true);
  }
  function update(value){
    if(phase!=='loading')return;
    const next=Math.min(99,Math.floor(value));
    if(next>progress){paint(next);assembly.update(next);}
    armWatchdog();
  }
  function scriptError(event){
    if(event.target?.src?.includes('/main-intro.js'))fail();
  }
  window.addEventListener('error',scriptError,true);
  window.MainIntroLoading={
    update,finish:()=>finish(),fail,
    // Let the loading animation paint between geometry batches.
    yieldFrame:()=>new Promise(resolve=>document.hidden?setTimeout(resolve,16):requestAnimationFrame(()=>setTimeout(resolve,0))),
    inspect:()=>({progress,phase,icon:icon.id})
  };
  if(window.MainIntroLoadFailed)fail();else armWatchdog();
})();
