// All UI CSS lives here and is injected once. System font stacks only (embedded WOFF2 subsets deferred).
export const CSS = `
.os-root{position:absolute;inset:0;pointer-events:none;overflow:hidden;font:13px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg,#e8ecf2);--os-s:1;--os-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;-webkit-tap-highlight-color:transparent}
#ui > .os-root{pointer-events:none}
.os-root *{box-sizing:border-box}
.os-root button,.os-root input,.os-root select{font:inherit;color:inherit;margin:0}
.os-root .mono,.os-mono{font-family:var(--os-mono);font-variant-numeric:tabular-nums}
.os-root :focus{outline:none}
.os-root :focus-visible{outline:2px solid var(--oiii,#2fd6c3);outline-offset:2px}
.os-glass{background:var(--glass,rgba(14,17,24,.72));-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line,rgba(255,255,255,.12));border-radius:12px;pointer-events:auto}
.os-chrome{transition:opacity .6s ease}
.os-idle .os-chrome:not(:hover):not(:focus-within){opacity:.3}
.os-hidden .os-chrome,.os-hidden .os-labels,.os-hidden .os-corner,.os-hidden .os-dialog,.os-photo .os-chrome,.os-photo .os-labels,.os-photo .os-corner,.os-photo .os-dialog{display:none!important}
.os-btn{background:none;border:1px solid transparent;border-radius:8px;cursor:pointer;padding:0 10px;height:34px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;pointer-events:auto}
.os-btn:hover{background:rgba(255,255,255,.1)}
.os-btn[aria-pressed=true],.os-btn[aria-checked=true],.os-btn.on{background:rgba(255,59,69,.22);border-color:var(--ha,#ff3b45)}
.os-btn[disabled]{opacity:.35;cursor:default}
.os-ib{width:36px;padding:0}
.os-ico{display:inline-flex;line-height:0}
.os-dim{color:var(--dim,#8a93a3)}
/* top bar */
.os-top{position:absolute;top:max(10px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));display:flex;gap:10px;align-items:flex-start;pointer-events:none;z-index:3}
.os-bc{flex:1 1 auto;min-width:0;height:38px;display:flex;align-items:center;padding:0 6px}
.os-bc ol{flex:0 1 auto;min-width:0;display:flex;align-items:center;list-style:none;margin:0;padding:0;white-space:nowrap;overflow-x:auto;scrollbar-width:none}
.os-bc ol::-webkit-scrollbar{display:none}
.os-bc.clip ol{-webkit-mask-image:linear-gradient(to right,transparent,#000 28px);mask-image:linear-gradient(to right,transparent,#000 28px)}
.os-bc li{flex:none}
.os-bc li+li::before{content:"\\203A";color:var(--dim,#8a93a3);padding:0 2px}
.os-bc .os-btn{height:28px;padding:0 6px}
.os-bc .cur{padding:0 6px;font-weight:600}
.os-lvl{margin-left:auto;padding:0 8px 0 12px;color:var(--oiii,#2fd6c3);font-size:11px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.os-search{position:relative;flex:0 0 260px;pointer-events:none}
.os-search-box{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px}
.os-search-box input{flex:1;min-width:0;background:none;border:0;height:36px;font-size:14px}
.os-search-box input:focus-visible{outline:none}
.os-search-box:focus-within{border-color:var(--oiii,#2fd6c3)}
.os-search-box input::placeholder{color:var(--dim,#8a93a3)}
.os-kbd{font:11px var(--os-mono);color:var(--dim,#8a93a3);border:1px solid var(--line,rgba(255,255,255,.2));border-radius:4px;padding:0 5px}
.os-results,.os-dialog{background:rgba(14,17,24,.92)}
.os-results{position:absolute;top:44px;right:0;width:min(380px,calc(100vw - 20px));max-height:min(60vh,520px);overflow:auto;padding:6px;z-index:6}
.os-grp{padding:8px 8px 3px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--oiii,#2fd6c3)}
.os-res{display:flex;align-items:baseline;gap:8px;padding:6px 8px;border-radius:7px;cursor:pointer}
.os-res .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.os-res .t{color:var(--dim,#8a93a3);font-size:11px}
.os-res .d{font:12px var(--os-mono);font-variant-numeric:tabular-nums;color:var(--dim,#8a93a3)}
.os-res[aria-selected=true]{background:rgba(255,59,69,.22);box-shadow:inset 2px 0 var(--ha,#ff3b45)}
.os-empty{padding:10px;color:var(--dim,#8a93a3)}
/* toolbar */
.os-tools{position:absolute;left:max(10px,env(safe-area-inset-left));top:calc(max(10px,env(safe-area-inset-top)) + 48px);display:flex;flex-direction:column;gap:2px;padding:4px;z-index:3;max-height:calc(100% - 200px);overflow:auto;scrollbar-width:none}
/* info panel */
.os-info{position:absolute;right:max(10px,env(safe-area-inset-right));top:calc(max(10px,env(safe-area-inset-top)) + 48px);width:300px;max-height:calc(100% - 190px);overflow:auto;padding:12px 14px 12px;z-index:2}
.os-info[hidden]{display:none}
.os-info header{display:flex;align-items:center;gap:8px;cursor:default}
.os-info h2{margin:0;font-size:18px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.os-chip{font-size:10px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line,rgba(255,255,255,.25));color:var(--dim,#8a93a3);border-radius:99px;padding:1px 8px;white-space:nowrap}
.os-info .tg{transition:transform .2s}
.os-info.collapsed .tg{transform:rotate(-90deg)}
.os-info.collapsed .body{display:none}
.os-info dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:10px 0 8px}
.os-info dt{color:var(--dim,#8a93a3)}
.os-info dd{margin:0;text-align:right;font-family:var(--os-mono);font-variant-numeric:tabular-nums}
.os-desc{margin:6px 0;color:#c9d0dc;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.os-desc.open{display:block}
.os-link{background:none;border:0;color:var(--oiii,#2fd6c3);cursor:pointer;padding:0;font-size:12px}
.os-goto{margin-top:8px;border-top:1px solid var(--line,rgba(255,255,255,.12));padding-top:8px}
.os-goto h3{margin:0 0 4px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--oiii,#2fd6c3);font-weight:500}
.os-goto .os-btn{width:100%;justify-content:space-between;height:30px}
.os-goto .d{font:12px var(--os-mono);color:var(--dim,#8a93a3)}
/* corner (orientation + scale) */
.os-corner{position:absolute;left:max(10px,env(safe-area-inset-left));bottom:calc(max(10px,env(safe-area-inset-bottom)) + 0px);display:flex;flex-direction:column;align-items:flex-start;gap:6px;z-index:2;pointer-events:none}
.os-scale{display:flex;flex-direction:column;gap:2px;font:11px var(--os-mono);padding:4px 8px 6px;width:max-content;min-width:60px}
.os-scale i{display:block;height:6px;border:1.5px solid var(--oiii,#2fd6c3);border-top:0}
/* timeline */
.os-bottom{position:absolute;bottom:max(10px,env(safe-area-inset-bottom));left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));display:flex;justify-content:center;pointer-events:none;z-index:2}
.os-tl{width:min(780px,100%);padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.os-tl .r{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.os-date{font:14px var(--os-mono);font-variant-numeric:tabular-nums;background:rgba(255,255,255,.06);border:1px solid var(--line,rgba(255,255,255,.2));border-radius:8px;height:32px;padding:0 8px;width:21ch;text-align:center}
.os-badge{font-size:11px;color:#111;background:#ffb454;border-radius:99px;padding:2px 9px;white-space:nowrap}
.os-scrub{flex:1;min-width:110px;accent-color:var(--ha,#ff3b45);height:28px;margin:0 4px}
.os-rates{display:flex;gap:2px;flex-wrap:wrap;flex:1}
.os-rates .os-btn{height:28px;padding:0 7px;font-size:12px}
.os-rate-one{display:none!important;min-width:84px}
.os-grow{flex:1}
/* labels */
.os-labels{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1}
.os-label{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:6px;background:none;border:0;padding:3px 6px 3px 2px;border-radius:6px;font-size:calc(12px * var(--os-s));line-height:1.1;text-shadow:0 0 4px #000,0 0 2px #000;color:#e8ecf2;white-space:nowrap;opacity:0;visibility:hidden;transition:opacity .22s ease;will-change:transform,opacity}
.os-label.on{visibility:visible}
.os-label::before{content:"";width:calc(6px * var(--os-s));height:calc(6px * var(--os-s));border-radius:50%;border:1.5px solid var(--oiii,#2fd6c3);flex:none}
.os-label:hover,.os-label:focus-visible{background:rgba(14,17,24,.8);z-index:2}
.os-label.is-focus{color:#fff;font-weight:600}
.os-label.is-focus::before{border-color:var(--ha,#ff3b45);background:var(--ha,#ff3b45)}
.os-hc .os-label{background:#000;color:#fff;border:1px solid #fff;text-shadow:none;font-weight:600}
.os-hc .os-label::before{border-color:#fff}
.os-hc .os-glass{background:#000;border-color:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}
.os-hc{--dim:#d0d6e0}
/* dialogs */
.os-dialog{position:absolute;left:calc(max(10px,env(safe-area-inset-left)) + 52px);top:calc(max(10px,env(safe-area-inset-top)) + 48px);width:min(360px,calc(100vw - 20px));max-height:calc(100% - 140px);overflow:auto;padding:14px 16px;z-index:5}
.os-dialog[hidden],.os-measure[hidden],.os-photo-panel[hidden],.os-caption[hidden]{display:none}
.os-dialog h2{margin:0 0 10px;font-size:15px;display:flex;align-items:center;gap:8px}
.os-dialog h2 .os-grow{flex:1}
.os-dialog h3{margin:14px 0 6px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--oiii,#2fd6c3);font-weight:500}
.os-set{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:34px}
.os-set>label,.os-set>span.l{flex:none}
.os-seg{display:inline-flex;border:1px solid var(--line,rgba(255,255,255,.2));border-radius:8px;overflow:hidden}
.os-seg .os-btn{border-radius:0;height:28px;padding:0 9px;font-size:12px;border:0}
.os-seg .os-btn[aria-checked=true]{background:rgba(255,59,69,.3)}
.os-sw{width:42px;height:24px;border-radius:99px;border:1px solid var(--line,rgba(255,255,255,.3));background:rgba(255,255,255,.08);position:relative;cursor:pointer;padding:0;flex:none}
.os-sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#cfd5e0;transition:transform .15s}
.os-sw[aria-checked=true]{background:rgba(255,59,69,.5);border-color:var(--ha,#ff3b45)}
.os-sw[aria-checked=true]::after{transform:translateX(18px);background:#fff}
.os-dialog input[type=range]{accent-color:var(--ha,#ff3b45);flex:1;min-width:90px}
.os-tour{display:block;width:100%;text-align:left;height:auto;padding:9px 10px;margin-bottom:6px;border:1px solid var(--line,rgba(255,255,255,.18))}
.os-tour b{display:block;font-weight:600}
.os-tour span{color:var(--dim,#8a93a3);font-size:12px}
.os-attr{margin:0 0 8px;padding:0;list-style:none}
.os-attr li{padding:6px 0;border-bottom:1px solid var(--line,rgba(255,255,255,.1))}
.os-attr a{color:var(--oiii,#2fd6c3)}
.os-attr small{display:block;color:var(--dim,#8a93a3)}
.os-keys{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;margin:0}
.os-keys dt{font-family:var(--os-mono);color:var(--oiii,#2fd6c3)}
.os-keys dd{margin:0;color:#c9d0dc}
/* tour caption, measure, photo, toasts */
.os-caption{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(10px,env(safe-area-inset-bottom)) + var(--os-bar,96px) + 14px);width:min(640px,calc(100vw - 20px));padding:12px 16px 10px;z-index:4;text-align:center}
.os-caption p{margin:0 0 8px;font-size:15px}
.os-caption .bar{height:2px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden;margin-bottom:6px}
.os-caption .bar i{display:block;height:100%;background:var(--ha,#ff3b45);width:0;transition:width .6s linear}
.os-caption .t{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--dim,#8a93a3)}
.os-measure{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(10px,env(safe-area-inset-top)) + 52px);padding:8px 12px;display:flex;align-items:center;gap:10px;z-index:4;max-width:calc(100vw - 20px)}
.os-measure-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
.os-measure-svg line{stroke:var(--ha,#ff3b45);stroke-width:1.5;stroke-dasharray:5 4}
.os-measure-svg circle{fill:none;stroke:var(--ha,#ff3b45);stroke-width:2}
.os-photo-panel{position:absolute;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));width:min(560px,calc(100vw - 20px));padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;z-index:4}
.os-photo-panel input[type=range]{flex:1;min-width:140px;accent-color:var(--ha,#ff3b45)}
.os-toasts{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(10px,env(safe-area-inset-top)) + 100px);display:flex;flex-direction:column;gap:6px;z-index:9;width:min(480px,calc(100vw - 20px));pointer-events:none}
.os-toast{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;font-size:13px}
.os-toast.err{border-color:var(--ha,#ff3b45)}
.os-toast span{flex:1}
.os-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.os-rm *{transition:none!important}
input[type=range].os-scrub,.os-dialog input[type=range],.os-photo-panel input[type=range]{-webkit-appearance:none;appearance:none;background:none;height:24px;cursor:pointer}
input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:rgba(255,255,255,.22)}
input[type=range]::-moz-range-track{height:4px;border-radius:4px;background:rgba(255,255,255,.22)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--ha,#ff3b45);border:2px solid #fff;margin-top:-6px}
input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--ha,#ff3b45);border:2px solid #fff}
/* phones: every control is a >=44 px touch target; the info sheet and tour caption stack above the measured time bar (--os-bar) */
@media (max-width:699px){
  .os-top{flex-wrap:wrap;gap:6px}
  .os-bc{flex:1 1 100%;height:46px}
  .os-bc .os-btn{height:44px;min-width:44px;padding:0 8px}
  .os-bc .cur{padding:0 8px}
  .os-search{flex:1 1 100%}
  .os-search-box{height:46px}
  .os-search-box input{height:44px;font-size:16px}
  .os-results{left:0;right:0;width:auto;top:52px}
  .os-res{padding:12px 10px}
  .os-kbd{display:none}
  .os-btn{min-height:44px}
  .os-ib,.os-tools .os-ib{width:44px;height:44px}
  .os-tools{top:calc(max(10px,env(safe-area-inset-top)) + 106px);flex-direction:column;gap:0}
  .os-corner{left:auto;right:max(10px,env(safe-area-inset-right));bottom:auto;top:calc(max(10px,env(safe-area-inset-top)) + 106px);align-items:flex-end}
  .os-corner .os-btn{height:44px}
  .os-info{left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));width:auto;top:auto;bottom:calc(max(10px,env(safe-area-inset-bottom)) + var(--os-bar,96px) + 10px);max-height:max(120px,calc(100% - 470px - var(--os-bar,96px)));padding:6px 10px;z-index:1}
  .os-info header{min-height:44px}
  .os-info .os-goto .os-btn{height:44px}
  .os-link{min-height:44px;padding:0 6px;display:inline-flex;align-items:center}
  .os-touring .os-info{display:none}
  .os-rates,.os-tl .hide-phone{display:none}
  .os-rate-one{display:inline-flex!important}
  .os-tl{padding:6px 8px;gap:2px}
  .os-tl .r{gap:4px}
  .os-tl .os-btn{height:44px}
  .os-tl .os-ib{width:44px}
  .os-date{font-size:13px;width:20ch;height:44px;flex:none}
  input[type=range].os-scrub{height:44px;min-width:60px}
  .os-dialog{left:10px;right:10px;width:auto;top:calc(max(10px,env(safe-area-inset-top)) + 106px);max-height:calc(100% - 136px - var(--os-bar,96px))}
  .os-dialog .os-seg .os-btn{height:44px;padding:0 10px}
  .os-dialog input[type=range],.os-photo-panel input[type=range]{height:44px}
  .os-set{min-height:48px}
  .os-sw{width:52px;height:32px}
  .os-sw::after{width:24px;height:24px}
  .os-sw[aria-checked=true]::after{transform:translateX(20px)}
  .os-sw::before{content:"";position:absolute;inset:-8px -4px}
  .os-tour{min-height:44px}
  .os-caption{bottom:calc(max(10px,env(safe-area-inset-bottom)) + var(--os-bar,96px) + 10px)}
  .os-caption .t .os-btn{height:44px}
  .os-photo-panel .os-btn{height:44px}
  .os-toasts{top:calc(max(10px,env(safe-area-inset-top)) + 110px)}
}
/* touch: grow label hit areas without changing their layout footprint */
@media (pointer:coarse){.os-label::after{content:"";position:absolute;inset:-12px -8px}}
@media (min-width:700px) and (max-width:1099px){.os-corner{bottom:calc(max(10px,env(safe-area-inset-bottom)) + 96px)}}
@media (min-width:1100px){.os-bottom{left:220px;right:220px}}
@media (prefers-contrast:more){.os-root{--dim:#d0d6e0}}
`;
