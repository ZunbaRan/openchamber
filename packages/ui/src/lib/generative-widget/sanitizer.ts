import DOMPurify, { type Config, type UponSanitizeAttributeHook } from 'dompurify';

/** OpenChamber Generative Widget sanitizer + receiver srcdoc (behavior aligned with CodePilot reference). */
/**
 * Widget HTML sanitizer + iframe srcdoc builder.
 *
 * Security model:
 *
 * 1. **Streaming updates** (pushed to iframe via postMessage):
 *    - Dangerous embedding tags stripped (iframe, object, embed, form, etc.)
 *    - ALL on* handlers stripped (preview is purely visual)
 *    - ALL script tags stripped
 *    - javascript:/data: URLs in href/src/action stripped
 *
 * 2. **Finalized rendering** (pushed to iframe via postMessage):
 *    - Only dangerous embedding tags stripped
 *    - Scripts execute inside the sandboxed iframe (safe)
 *    - Handlers execute inside the sandboxed iframe (safe)
 *
 * 3. **iframe sandbox** (set by WidgetRenderer):
 *    - `sandbox="allow-scripts"` only
 *    - No allow-same-origin, allow-top-navigation, allow-popups
 *    - CSP meta tag: script-src limited to CDN whitelist + inline;
 *      connect-src 'none' blocks fetch/XHR/WebSocket
 *    - Links intercepted, forwarded to parent via postMessage
 *    - Height synced via ResizeObserver + postMessage
 */

// ── CDN whitelist ──────────────────────────────────────────────────────────

export const CDN_WHITELIST = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
];

// ── HTML sanitization ────────────────────────────────────────────────────

const DANGEROUS_TAGS = /<(iframe|object|embed|meta|link|base|form)[\s/>][\s\S]*?<\/\1>/gi;
const DANGEROUS_VOID = /<(iframe|object|embed|meta|link|base|form)\b[^>]*\/?>/gi;

// ── Fail-closed URL canonicalizer for streaming URL attributes ────────────
//
// The streaming preview feeds sanitized HTML into iframe innerHTML in an
// allow-scripts / unsafe-inline environment, so URL attributes must be
// evaluated after browser-equivalent canonicalization or entity/whitespace-
// obfuscated active schemes (java&#x73;cript:, java&Tab;cript&colon;,
// xlink:href) would survive into innerHTML and execute. Browser execution uses
// the existing DOMPurify dependency, while the small deterministic decoder
// below makes the URL allowlist independently testable in headless Bun.

/** Only these explicit schemes may survive a streaming preview. */
const SAFE_STREAMING_SCHEMES = new Set(['http', 'https', 'mailto']);

/** Single-URL attributes evaluated after browser parsing/entity decoding. */
const STREAMING_URL_ATTRS = new Set([
  'action',
  'background',
  'cite',
  'formaction',
  'href',
  'longdesc',
  'poster',
  'src',
  'usemap',
  'xlink:href',
]);

/** Multi-URL/embedded-document attributes are removed rather than reparsed. */
const STREAMING_FORBIDDEN_URL_ATTRS = new Set(['imagesrcset', 'ping', 'srcdoc', 'srcset']);

const MAX_WIDGET_HTML_BYTES = 1024 * 1024;
const exceedsWidgetHtmlByteLimit = (value: string): boolean => {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > MAX_WIDGET_HTML_BYTES) return true;
  }
  return false;
};

/** Named HTML character references mapping to URL/whitespace-significant ASCII. */
const NAMED_REFS: Record<string, string> = {
  amp: '&',
  apos: "'",
  ast: '*',
  bsol: '\\',
  colon: ':',
  comma: ',',
  commat: '@',
  dollar: '$',
  equals: '=',
  excl: '!',
  gt: '>',
  hyphen: '-',
  lbrace: '{',
  lowbar: '_',
  lpar: '(',
  lsqb: '[',
  lt: '<',
  NewLine: '\n',
  nbsp: '\u00a0',
  num: '#',
  period: '.',
  plus: '+',
  quest: '?',
  quot: '"',
  rbrace: '}',
  rpar: ')',
  rsqb: ']',
  semi: ';',
  sol: '/',
  Tab: '\t',
  tilde: '~',
  verbar: '|',
  vert: '|',
};

/**
 * Decode numeric (&#NNN; / &#xHH;) and the named HTML character references
 * above. Iterates (bounded) so nested sequences like `&amp;colon;` fully
 * canonicalize to `:`. Unknown references are left as-is.
 */
const MAX_DECODE_PASSES = 5;
function decodeHtmlReferences(input: string): string {
  let out = input;
  for (let pass = 0; pass < MAX_DECODE_PASSES && out.includes('&'); pass++) {
    out = out.replace(
      /&(#[0-9]{1,7};?|#[xX][0-9a-fA-F]{1,6};?|[a-zA-Z][a-zA-Z0-9]{1,31};?)/g,
      (m) => {
        const body = m.slice(1, m.endsWith(';') ? -1 : undefined);
        if (body[0] === '#') {
          const hex = body[1] === 'x' || body[1] === 'X';
          const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
          if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
            return String.fromCodePoint(code);
          }
          return m;
        }
        return NAMED_REFS[body] ?? m;
      },
    );
  }
  return out;
}

/** Strip ASCII control chars + whitespace, matching browser URL trimming. */
const ASCII_CONTROL_WHITESPACE = /[\u0000-\u0020\u007f]/g;

function canonicalizeUrl(raw: string): string {
  return decodeHtmlReferences(raw).replace(ASCII_CONTROL_WHITESPACE, '');
}

function getScheme(canonical: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(canonical);
  return m ? m[1].toLowerCase() : '';
}

/** Fail closed for any explicit scheme outside the narrow allowlist. */
export function isSafeStreamingUrl(raw: string): boolean {
  const scheme = getScheme(canonicalizeUrl(raw));
  return scheme === '' || SAFE_STREAMING_SCHEMES.has(scheme);
}

const streamingAttributeHook: UponSanitizeAttributeHook = (_node, data) => {
  const name = data.attrName.toLowerCase();
  if (STREAMING_FORBIDDEN_URL_ATTRS.has(name)) {
    data.keepAttr = false;
    return;
  }
  if (STREAMING_URL_ATTRS.has(name) && !isSafeStreamingUrl(data.attrValue)) {
    data.keepAttr = false;
  }
};

const STREAMING_SANITIZE_CONFIG: Config = {
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // DOMPurify applies this after the browser parser has normalized slash-
  // separated attributes and character references. The hook above repeats the
  // same fail-closed policy for every URL-bearing attribute we support.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z0-9._~-]+(?:[/?#]|$))/i,
  FORBID_ATTR: ['srcdoc'],
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'meta',
    'link',
    'base',
    'form',
    'animate',
    'animatemotion',
    'animatetransform',
    'set',
  ],
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
};

/**
 * Sanitize widget HTML for streaming preview (no interactivity).
 * Strips: dangerous tags, ALL on* handlers, ALL scripts, and any
 * href/src/action/xlink:href whose canonicalized scheme is active.
 */
export function sanitizeForStreaming(html: string): string {
  // DOMPurify is already a direct UI dependency and uses the browser's HTML
  // parser, which is required for slash-separated/malformed attribute syntax.
  // SSR/headless callers have no DOM and therefore fail closed to no preview.
  if (exceedsWidgetHtmlByteLimit(html)) return '';
  if (!DOMPurify.isSupported || typeof DOMPurify.sanitize !== 'function') return '';
  DOMPurify.addHook('uponSanitizeAttribute', streamingAttributeHook);
  try {
    return DOMPurify.sanitize(html, STREAMING_SANITIZE_CONFIG) as string;
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', streamingAttributeHook);
  }
}

/**
 * Light sanitization for finalized content inside iframe.
 * Only strips tags that could nest/break out of the sandbox.
 */
export function sanitizeForIframe(html: string): string {
  if (exceedsWidgetHtmlByteLimit(html)) return '';
  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const element of template.content.querySelectorAll('iframe,object,embed,meta,link,base,form')) {
      element.remove();
    }
    return template.innerHTML;
  }
  return html
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_VOID, '');
}

// ── Receiver iframe srcdoc ────────────────────────────────────────────────

/**
 * Build the "receiver" iframe document.
 *
 * This iframe stays alive for the widget's entire lifetime. Content is
 * pushed into it via postMessage in two phases:
 *
 * 1. **Streaming** (`widget:update`): sanitized HTML (no scripts/handlers)
 *    is set as innerHTML. Height grows incrementally.
 *
 * 2. **Finalize** (`widget:finalize`): full HTML is set. Script elements
 *    are cloned-and-replaced to trigger execution.
 *
 * Also handles: height sync, link interception, theme updates, sendMessage.
 */
export function buildReceiverSrcdoc(
  styleBlock: string,
  isDark: boolean,
): string {
  const cspDomains = CDN_WHITELIST.map(d => 'https://' + d).join(' ');
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cspDomains}`,
    "style-src 'unsafe-inline'",
    "img-src * data: blob:",
    "font-src * data:",
    "connect-src 'none'",
  ].join('; ');

  const receiverScript = `(function(){
var root=document.getElementById('__root');
var _t=null,_first=true;
function _h(){
if(_t)clearTimeout(_t);
_t=setTimeout(function(){
var r=root.getBoundingClientRect();
var h=Math.ceil(r.height);
if(h>0&&h!==_lastH){_lastH=h;parent.postMessage({type:'widget:resize',height:h,first:_first},'*');}
_first=false;
},60);
}
var _lastH=0;
var _ro=new ResizeObserver(_h);
_ro.observe(root);

function applyHtml(html){
if(typeof html!=='string'||html.length>1048576)return;
var tmp=document.createElement('template');
tmp.innerHTML=html;
_sanitizeStreaming(tmp.content);
root.replaceChildren(tmp.content);
_h();
}

function _safeStreamingUrl(value){
var compact='';
for(var i=0;i<value.length;i++){var code=value.charCodeAt(i);if(code>32&&code!==127)compact+=value.charAt(i)}
var match=/^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
return !match||/^(https?|mailto)$/i.test(match[1]);
}

function _sanitizeStreaming(container){
var forbidden=container.querySelectorAll('script,iframe,object,embed,meta,link,base,form,animate,animateMotion,animateTransform,set');
for(var i=0;i<forbidden.length;i++)forbidden[i].remove();
var nodes=container.querySelectorAll('*');
var single='|action|background|cite|formaction|href|longdesc|poster|src|usemap|xlink:href|';
var multi='|imagesrcset|ping|srcdoc|srcset|';
for(var n=0;n<nodes.length;n++){
var attrs=nodes[n].attributes;
for(var a=attrs.length-1;a>=0;a--){
var name=attrs[a].name.toLowerCase();
if(name.slice(0,2)==='on'||multi.indexOf('|'+name+'|')!==-1||(single.indexOf('|'+name+'|')!==-1&&!_safeStreamingUrl(attrs[a].value)))nodes[n].removeAttribute(attrs[a].name);
}
}
}

function finalizeHtml(html){
if(typeof html!=='string'||html.length>1048576)return;
// Parse finalized HTML in a temp container to separate scripts from content
var tmp=document.createElement('div');
tmp.innerHTML=html;
var forbidden=tmp.querySelectorAll('iframe,object,embed,meta,link,base,form');
for(var fi=0;fi<forbidden.length;fi++)forbidden[fi].remove();
var ss=tmp.querySelectorAll('script');
var scripts=[];
for(var i=0;i<ss.length;i++){
scripts.push({src:ss[i].src||'',text:ss[i].textContent||'',attrs:[]});
for(var j=0;j<ss[i].attributes.length;j++){
var a=ss[i].attributes[j];
if(a.name!=='src')scripts[scripts.length-1].attrs.push({name:a.name,value:a.value});
}
ss[i].remove();
}
// Update non-script content only if it differs (avoids repaint flash)
var visualHtml=tmp.innerHTML;
if(root.innerHTML!==visualHtml)root.innerHTML=visualHtml;
// Append and execute scripts without disturbing existing DOM.
// CDN scripts load first; inline scripts execute exactly once after ALL CDNs resolve.
// This avoids let/const redeclaration errors from re-injecting inline scripts.
var cdnScripts=scripts.filter(function(s){return !!s.src});
var inlineScripts=scripts.filter(function(s){return !s.src&&s.text});
function _appendInline(){
for(var k=0;k<inlineScripts.length;k++){
var s=document.createElement('script');
s.textContent=inlineScripts[k].text;
for(var j=0;j<inlineScripts[k].attrs.length;j++)s.setAttribute(inlineScripts[k].attrs[j].name,inlineScripts[k].attrs[j].value);
root.appendChild(s);
}
_h();
// Signal that all scripts (CDN + inline) have executed.
// Chart.js init runs synchronously inside inline scripts, so canvas is painted by now.
setTimeout(function(){parent.postMessage({type:'widget:scriptsReady'},'*')},50);
}
if(cdnScripts.length===0){
_appendInline();
}else{
// Wait for ALL CDN scripts to load/error, then run inline once
var _pending=cdnScripts.length;
function _onCdnDone(){_pending--;if(_pending<=0)_appendInline()}
for(var i=0;i<cdnScripts.length;i++){
var n=document.createElement('script');
n.src=cdnScripts[i].src;
n.onload=_onCdnDone;
n.onerror=_onCdnDone;
for(var j=0;j<cdnScripts[i].attrs.length;j++){
if(cdnScripts[i].attrs[j].name!=='onload')n.setAttribute(cdnScripts[i].attrs[j].name,cdnScripts[i].attrs[j].value);
}
root.appendChild(n);
}
}
_h();
}

window.addEventListener('message',function(e){
if(e.source!==parent||!e.data)return;
switch(e.data.type){
case 'widget:update':
applyHtml(e.data.html);
break;
case 'widget:finalize':
finalizeHtml(e.data.html);
setTimeout(_h,150);
break;
case 'widget:theme':
var r=document.documentElement,v=e.data.vars;
if(v)for(var k in v)r.style.setProperty(k,v[k]);
if(typeof e.data.isDark==='boolean')r.className=e.data.isDark?'dark':'';
setTimeout(_h,100);
break;
case 'widget:crossFilter':
// Received from parent: another widget published a filter event
window.dispatchEvent(new CustomEvent('widget-filter',{detail:e.data.payload}));
break;
case 'widget:capture':
// Send HTML + canvas snapshots back to parent for compositing.
// Parent renders HTML in a normal div and overlays canvas images.
// This avoids foreignObject limitations entirely.
try{
var rootEl=document.getElementById('__root');
var html=rootEl?rootEl.innerHTML:'';
var styles='';
var styleEls=document.querySelectorAll('style');
for(var si=0;si<styleEls.length;si++)styles+=styleEls[si].textContent;
// Snapshot each canvas as base64 image
var canvasSnapshots=[];
var allCanvases=document.querySelectorAll('canvas');
for(var ci=0;ci<allCanvases.length;ci++){
try{
var cvs=allCanvases[ci];
canvasSnapshots.push({dataUrl:cvs.toDataURL('image/png'),width:cvs.offsetWidth,height:cvs.offsetHeight});
// Replace canvas in HTML with a placeholder img
var placeholder=document.createElement('img');
placeholder.setAttribute('data-canvas-export',ci.toString());
placeholder.style.cssText='width:'+cvs.offsetWidth+'px;height:'+cvs.offsetHeight+'px;display:block;';
cvs.parentNode.insertBefore(placeholder,cvs);
cvs.style.display='none';
}catch(ce){canvasSnapshots.push(null)}
}
// Re-read HTML with placeholders
var htmlWithPlaceholders=rootEl?rootEl.innerHTML:'';
// Restore canvases
var placeholders=document.querySelectorAll('[data-canvas-export]');
for(var pi=0;pi<placeholders.length;pi++)placeholders[pi].remove();
for(var ci=0;ci<allCanvases.length;ci++)allCanvases[ci].style.display='';
parent.postMessage({type:'widget:captured',html:htmlWithPlaceholders,styles:styles,canvases:canvasSnapshots,bodyWidth:document.body.scrollWidth,bodyHeight:document.body.scrollHeight},'*');
}catch(err){parent.postMessage({type:'widget:captured',html:null},'*')}
break;
}
});

document.addEventListener('click',function(e){
var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
if(!a)return;var h=a.getAttribute('href');
if(!h||h.charAt(0)==='#')return;
e.preventDefault();
parent.postMessage({type:'widget:link',href:h},'*');
});

window.__widgetSendMessage=function(t){
if(typeof t!=='string'||t.length>500)return;
parent.postMessage({type:'widget:sendMessage',text:t},'*');
};

// Cross-widget communication: publish filter/selection events to other widgets
window.__widgetPublish=function(topic,data){
if(typeof topic!=='string')return;
parent.postMessage({type:'widget:publish',topic:topic,data:data},'*');
};

parent.postMessage({type:'widget:ready'},'*');
})();`;

  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
${styleBlock}
</style>
</head>
<body style="margin:0;padding:0;height:fit-content;">
<div id="__root" style="height:fit-content;"></div>
<script>${receiverScript}</script>
</body>
</html>`;
}
