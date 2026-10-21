let movies=[];
let movieSources=[];
let watchedIndices=[];
let currentMovie=null;
let activeMovieIndex=-1;
let activeMovieSlug='';
let movieDisplayRequest=0;
let nextMovieRequest=0;
let historyNavigationRequest=0;
const movieLoadTimeout=15000;
let isSpeaking=false;
let speechTimeout=null;
let pullStartY=0;
let pullTracking=false;
let isPullRefreshing=false;
const pullRefreshThreshold=90;

const fallbackPoster='data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 600%22%3E%3Crect width=%22400%22 height=%22600%22 fill=%22%231b1b1b%22/%3E%3Crect x=%22120%22 y=%22170%22 width=%22160%22 height=%22190%22 rx=%2210%22 fill=%22none%22 stroke=%22%23777777%22 stroke-width=%228%22/%3E%3Cpath d=%22M150 315l40-45 35 35 25-25 25 35%22 fill=%22none%22 stroke=%22%23777777%22 stroke-width=%228%22/%3E%3Ctext x=%22200%22 y=%22415%22 text-anchor=%22middle%22 fill=%22%23aaaaaa%22 font-size=%2224%22 font-family=%22Arial,sans-serif%22%3ENO POSTER%3C/text%3E%3C/svg%3E';
const wikidataCache=new Map();
const wikipediaCache=new Map();
const wikidataEntityCache=new Map();
const movieDetailsCache=new Map();
const plotSummaryCache=new Map();
let prefetchedNextIndex=null;
let prefetchCandidateIndex=null;
let prefetchInProgress=null;

function updateDocumentTitle(showMovieTitle=false){
const overlay=document.getElementById('curtainOverlay');
if(!showMovieTitle||!overlay?.classList.contains('open')||overlay.classList.contains('loading-movie')||!currentMovie){
document.title='Picks';
return;
}
const title=currentMovie.title?.trim();
const year=currentMovie.year?.trim();
document.title=title?`Picks - ${title}${year?' '+year:''}`:'Picks';
}

async function loadMoviesDatabase(){
try{
setupMoviePosterSearch();
const listFiles=['movies-new.txt','movies-own.txt','movies-fav.txt'];
const listResults=await Promise.all(listFiles.map(async file=>{
const response=await fetch(file,{cache:'no-store'});
if(!response.ok)throw new Error(`Could not load ${file}: HTTP ${response.status}`);
return {file,text:await response.text()};
}));
const movieEntryMap=new Map();
listResults.forEach(({file,text})=>{
text.split(/\r?\n/).forEach(rawLine=>{
const line=rawLine.trim();
if(!line||line.startsWith('#'))return;
const movie=parseMovieLine(line);
if(!movie.year)return;
const key=normaliseTitle(`${movie.title} ${movie.year}`);
const existing=movieEntryMap.get(key);
if(existing){
if(!existing.sources.includes(file))existing.sources.push(file);
return;
}
movieEntryMap.set(key,{line,sources:[file]});
});
});
const movieEntries=Array.from(movieEntryMap.values());
movies=movieEntries.map(entry=>entry.line);
movieSources=movieEntries.map(entry=>entry.sources);

if(!movies.length){
await showNoMoviesToWatch();
return;
}
document.querySelector('#spotlightContent .spotlight-text').innerHTML='That’s a wrap!<br>Every movie has been featured.';

const isHomeScreenApp=window.navigator.standalone===true;
if(isHomeScreenApp&&location.hash){
history.replaceState(null,'',location.pathname+location.search);
}
const linkedIndex=isHomeScreenApp?-1:findMovieIndexFromHash();
applyMovieSectionStates();
if(linkedIndex>=0)normaliseMovieUrl(linkedIndex);
const navigationEntry=performance.getEntriesByType('navigation')[0];
const isPageRefresh=navigationEntry?.type==='reload';

window.addEventListener('popstate',handleMovieUrlChange);
window.addEventListener('hashchange',handleMovieUrlChange);

if(linkedIndex>=0&&isPageRefresh){
watchedIndices.push(linkedIndex);
await fetchNextMovie(false);
}else if(linkedIndex>=0){
watchedIndices.push(linkedIndex);
await displayMovieAtIndex(linkedIndex);
}else{
await fetchNextMovie(true);
}

setupPullToRefresh();
}catch(error){
console.error('Error loading movie lists:',error);
document.getElementById('movieTitle').innerText='Error Loading Movie Lists';
document.getElementById('movieSynopsis').innerText=error.message||'One or more movie list files could not be loaded.';
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
overlay.classList.remove('open','no-light','loading-movie');
updateDocumentTitle(false);
document.querySelector('#spotlightContent .spotlight-text').textContent='Error loading movie lists. Check that movies-new.txt, movies-own.txt, and movies-fav.txt are available.';
document.getElementById('reloadBtn').style.display='none';
await new Promise(resolve=>setTimeout(resolve,600));
overlay.classList.add('show-spotlight');
}
}

function setupPullToRefresh(){
const indicator=document.createElement('div');
indicator.id='pullRefreshIndicator';
indicator.textContent='↓ Pull to refresh movie';
document.body.append(indicator);
let pullDistance=0;
let pullStartX=0;
window.addEventListener('touchstart',event=>{
if(event.touches.length!==1||window.scrollY>0||isPullRefreshing)return;
if(event.target.closest('.synopsis-scroll-area'))return;
pullStartY=event.touches[0].clientY;
pullStartX=event.touches[0].clientX;
pullDistance=0;
pullTracking=true;
},{passive:true});
window.addEventListener('touchmove',event=>{
if(!pullTracking||event.touches.length!==1)return;
const deltaX=event.touches[0].clientX-pullStartX;
pullDistance=event.touches[0].clientY-pullStartY;
if(Math.abs(deltaX)>Math.abs(pullDistance)&&Math.abs(deltaX)>12){
pullTracking=false;
indicator.classList.remove('visible','ready');
indicator.style.transform='';
return;
}
if(pullDistance<=0){
indicator.classList.remove('visible','ready');
return;
}
if(window.scrollY>0){
pullTracking=false;
indicator.classList.remove('visible','ready');
return;
}
event.preventDefault();
if(pullDistance>8){
indicator.classList.add('visible');
indicator.classList.toggle('ready',pullDistance>=pullRefreshThreshold);
indicator.textContent=pullDistance>=pullRefreshThreshold?'↑ Release to refresh movie':'↓ Pull to refresh movie';
indicator.style.transform=`translate(-50%, ${Math.min(pullDistance*0.55,70)-70}px)`;
}
},{passive:false});
const finishPull=()=>{
if(!pullTracking)return;
pullTracking=false;
const shouldRefresh=pullDistance>=pullRefreshThreshold;
indicator.classList.remove('visible','ready');
indicator.style.transform='';
if(shouldRefresh&&!isPullRefreshing){
isPullRefreshing=true;
refreshMovieWithCurtains();
}
pullDistance=0;
};
window.addEventListener('touchend',finishPull,{passive:true});
window.addEventListener('touchcancel',()=>{
pullTracking=false;
pullDistance=0;
indicator.classList.remove('visible','ready');
indicator.style.transform='';
},{passive:true});
setupEdgeSwipes();
}

async function refreshMovieWithCurtains(){
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
updateDocumentTitle(false);
await scrollToTopAndWait();
resetPosterFlipCard();
overlay.classList.remove('no-light');
overlay.classList.add('loading-movie');
await new Promise(resolve=>setTimeout(resolve,300));
overlay.classList.remove('open');
await new Promise(resolve=>setTimeout(resolve,1000));
await new Promise(resolve=>setTimeout(resolve,300));
const refreshUrl=location.pathname+'?__picks_refresh='+Date.now()+location.hash;
location.replace(refreshUrl);
}

function setupEdgeSwipes(){
const poster=document.getElementById('posterLink');
if(!poster)return;
let startX=0;
let startY=0;
let tracking=false;
let horizontalSwipe=false;
let navigating=false;
const swipeThreshold=80;
poster.addEventListener('touchstart',event=>{
if(event.touches.length!==1||navigating)return;
startX=event.touches[0].clientX;
startY=event.touches[0].clientY;
tracking=true;
horizontalSwipe=false;
},{passive:true});
poster.addEventListener('touchmove',event=>{
if(!tracking||event.touches.length!==1)return;
const deltaX=event.touches[0].clientX-startX;
const deltaY=event.touches[0].clientY-startY;
if(Math.abs(deltaX)>12&&Math.abs(deltaX)>Math.abs(deltaY)){
horizontalSwipe=true;
event.preventDefault();
}
},{passive:false});
poster.addEventListener('touchend',event=>{
if(!tracking||event.changedTouches.length!==1)return;
tracking=false;
const endX=event.changedTouches[0].clientX;
const endY=event.changedTouches[0].clientY;
const deltaX=endX-startX;
const deltaY=endY-startY;
if(Math.abs(deltaX)<swipeThreshold||Math.abs(deltaY)>=Math.abs(deltaX)*0.8)return;
if(deltaX<0){
navigating=true;
fetchNextMovie().finally(()=>{navigating=false;});
}else if(history.state?.movie&&history.length>1){
navigating=true;
history.back();
setTimeout(()=>{navigating=false;},1200);
}
},{passive:true});
poster.addEventListener('touchcancel',()=>{tracking=false;horizontalSwipe=false;},{passive:true});
poster.addEventListener('click',event=>{
if(!horizontalSwipe)return;
event.preventDefault();
event.stopImmediatePropagation();
horizontalSwipe=false;
},true);
}

function setupMoviePosterSearch(){
const posterLink=document.getElementById('posterLink');
const card=document.getElementById('posterFlipCard');
const menu=document.getElementById('movieSearchMenu');
if(!posterLink||!card||!menu)return;
const closeButton=menu.querySelector('.movie-search-close');
const customSearchUrl=document.getElementById('customSearchUrl');
const watchNowButton=document.getElementById('watchNowBtn');
const customSearchStorageKey='picksCustomSearchUrl';
const parseCustomSearchConfig=value=>{
const parts=String(value||'').split(';');
const firstPart=parts.shift()||'';
const urlStart=firstPart.search(/https?:\/\//i);
if(urlStart<0)return {separator:'',urls:[]};
const rawPrefix=firstPart.slice(0,urlStart);
const separator=rawPrefix.trim()?rawPrefix.trim():(rawPrefix?' ':'');
const firstUrl=firstPart.slice(urlStart).trim().replace(/\\:/g,':');
const secondUrl=parts.join(';').trim().replace(/^\+/,'').replace(/\\:/g,':');
return {separator,urls:[firstUrl,...(secondUrl?[secondUrl]:[])]};
};
const isValidCustomSearchUrl=value=>{
const urls=parseCustomSearchConfig(value).urls;
return urls.length>0&&urls.every(url=>{try{const parsed=new URL(url);return (parsed.protocol==='http:'||parsed.protocol==='https:')&&Boolean(parsed.hostname);}catch(error){return false;}});
};
const getCurrentMovieIsOwn=()=>activeMovieIndex>=0&&(movieSources[activeMovieIndex]||[]).includes('movies-own.txt');
const updateCustomSearchState=()=>{const config=parseCustomSearchConfig(customSearchUrl.value);const valid=isValidCustomSearchUrl(customSearchUrl.value);menu.classList.toggle('has-custom-search-url',valid);watchNowButton.hidden=!valid;watchNowButton.textContent=valid&&config.urls.length>1&&getCurrentMovieIsOwn()?'Watch Now':'Watch';};
document.addEventListener('picks:movie-changed',updateCustomSearchState);
try{customSearchUrl.value=localStorage.getItem(customSearchStorageKey)||'';}catch(error){}
updateCustomSearchState();
customSearchUrl.addEventListener('input',()=>{try{localStorage.setItem(customSearchStorageKey,customSearchUrl.value);}catch(error){}updateCustomSearchState();});
const tmdbApiKeyInput=document.getElementById('tmdbApiKey');
const tmdbApiKeyStorageKey='picksTmdbApiKey';
try{if(tmdbApiKeyInput)tmdbApiKeyInput.value=localStorage.getItem(tmdbApiKeyStorageKey)||'';}catch(error){}
if(tmdbApiKeyInput){
tmdbApiKeyInput.addEventListener('input',()=>{try{localStorage.setItem(tmdbApiKeyStorageKey,tmdbApiKeyInput.value.trim());}catch(error){}});
tmdbApiKeyInput.addEventListener('change',()=>{
try{localStorage.setItem(tmdbApiKeyStorageKey,tmdbApiKeyInput.value.trim());}catch(error){}
movieDetailsCache.clear();
if(activeMovieIndex>=0)displayMovieAtIndex(activeMovieIndex);
});
}

watchNowButton.addEventListener('click',()=>{
const config=parseCustomSearchConfig(customSearchUrl.value);
if(!isValidCustomSearchUrl(customSearchUrl.value))return;
const rawTitle=document.getElementById('movieTitle').textContent.trim();
const title=Array.from(rawTitle).filter(char=>/[\p{L}\p{N}\s]/u.test(char)).join('').replace(/\s+/g,' ').trim();
const rawYear=document.getElementById('movieYear').textContent.trim();
const movieYear=rawYear&&rawYear!=='N/A'?Array.from(rawYear).filter(char=>/[0-9]/.test(char)).join(''):'';
const formattedName=config.separator?title.replace(/\s+/g,()=>config.separator):title;
const titleWithoutThe=title.replace(/^the\s+/i,'');
const formattedTitleWithoutThe=config.separator?titleWithoutThe.replace(/\s+/g,()=>config.separator):titleWithoutThe;
const lowerName=formattedName.toLocaleLowerCase(),upperName=formattedName.toLocaleUpperCase();
const lowerTitleWithoutThe=formattedTitleWithoutThe.toLocaleLowerCase(),upperTitleWithoutThe=formattedTitleWithoutThe.toLocaleUpperCase();
const yearSeparator=config.separator||(movieYear?' ':'');
const formatUrl=url=>url.replace(/%tname%%year%/gi,formattedTitleWithoutThe+yearSeparator+movieYear).replace(/%tlname%%year%/gi,lowerTitleWithoutThe+yearSeparator+movieYear).replace(/%tuname%%year%/gi,upperTitleWithoutThe+yearSeparator+movieYear).replace(/%tname%/gi,formattedTitleWithoutThe).replace(/%tlname%/gi,lowerTitleWithoutThe).replace(/%tuname%/gi,upperTitleWithoutThe).replace(/%name%%year%/gi,formattedName+yearSeparator+movieYear).replace(/%tlname%/gi,lowerTitleWithoutThe).replace(/%lname%/gi,lowerName).replace(/%tuname%/gi,upperTitleWithoutThe).replace(/%uname%/gi,upperName).replace(/%name%/gi,formattedName).replace(/%year%/gi,movieYear);
const isOwnMovie=getCurrentMovieIsOwn();
const selectedUrl=config.urls.length>1&&isOwnMovie?config.urls[1]:config.urls[0];
window.open(formatUrl(selectedUrl),'_blank','noopener,noreferrer');
});
const setFlipped=flipped=>{const wasFlipped=card.classList.contains('is-flipped');if(wasFlipped!==flipped)scrollToTopAndWait();card.classList.toggle('is-flipped',flipped);posterLink.setAttribute('aria-expanded',String(flipped));menu.setAttribute('aria-hidden',String(!flipped));menu.inert=!flipped;posterLink.setAttribute('aria-label',flipped?'Movie searches revealed':'Tap to reveal movie searches');};
const openMenu=()=>setFlipped(true);
const closeMenu=returnFocus=>{setFlipped(false);if(returnFocus)posterLink.focus({preventScroll:true});};
posterLink.addEventListener('click',event=>{event.preventDefault();openMenu();});
posterLink.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openMenu();}});
closeButton.addEventListener('click',()=>closeMenu(true));
menu.addEventListener('click',event=>{if(event.target.closest('.poster-back-controls'))return;const button=event.target.closest('button[data-search-type]');if(!button){closeMenu(true);return;}if(button.classList.contains('movie-search-close'))return;const movieTitle=document.getElementById('movieTitle').textContent.trim();const movieYear=document.getElementById('movieYear').textContent.trim();const searchType=button.dataset.searchType;const movieLabel=movieTitle+(movieYear?' '+movieYear:'');if(searchType==='wikipedia'){const wikiQuery=movieYear&&movieYear!=='N/A'?'\"'+movieTitle+'\" '+movieYear+' film':'\"'+movieTitle+'\" film';window.open('https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(wikiQuery),'_blank','noopener,noreferrer');return;}if(searchType==='imdb'){window.open('https://www.imdb.com/find/?q='+encodeURIComponent(movieLabel),'_blank','noopener,noreferrer');return;}const searchTerms={'full movie':'full movie complete film',trailer:'original theatrical trailer','behind the scenes':'behind the scenes BTS production footage cast interviews','making of':'making of documentary featurette production documentary',history:'film history retrospective documentary'};window.open('https://www.youtube.com/results?search_query='+encodeURIComponent(movieLabel+' '+(searchTerms[searchType]||searchType)),'_blank','noopener,noreferrer');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&card.classList.contains('is-flipped'))closeMenu(true);});
}
function parseMovieLine(line){
const cleaned=String(line||'').trim().replace(/^[-*+]\s+/,'').trim();
const match=cleaned.match(/^(.+?)\s+\(?([0-9]{4})\)?\s*$/);
return match?{title:match[1].trim(),year:match[2]}:{title:cleaned,year:''};
}

function movieSlug(title,year){
return normaliseTitle([title,year].filter(Boolean).join(' '));
}

function normaliseMovieUrl(index){
const movie=parseMovieLine(movies[index]);
const slug=movieSlug(movie.title,movie.year);
const movieUrl=`#${slug.replace(/\s+/g,'_')}`;
if(location.hash!==movieUrl)history.replaceState({movie:slug},'',movieUrl);
return slug;
}

const defaultMovieSectionStates={
movieSynopsisSection:true,
movieBlurbSection:true,
moviePlotSummarySection:false,
movieDetailsSection:true
};

function applyMovieSectionStates(){
Object.keys(defaultMovieSectionStates).forEach(id=>{
const section=document.getElementById(id);
if(section)section.open=defaultMovieSectionStates[id];
});
}

function findMovieIndexFromHash(){
let slug=location.hash.slice(1);
try{slug=decodeURIComponent(slug);}catch(error){}
slug=normaliseTitle(slug.replace(/_/g,' '));
if(!slug)return -1;
const exactIndex=movies.findIndex(line=>{
const movie=parseMovieLine(line);
return movieSlug(movie.title,movie.year)===slug;
});
if(exactIndex>=0)return exactIndex;
const requested=slug.match(/^(.*?)\s+((?:19|20)\d{2})$/);
const requestedTitle=requested?requested[1]:slug;
const requestedYear=requested?requested[2]:'';
const candidates=movies.map((line,index)=>{
const movie=parseMovieLine(line);
return {index,title:movie.title,year:movie.year,similarity:titleSimilarity(requestedTitle,movie.title)};
}).filter(movie=>requestedYear?movie.year===requestedYear&&movie.similarity>=0.8:movie.similarity>=0.8);
if(!candidates.length)return -1;
candidates.sort((a,b)=>b.similarity-a.similarity||Number(b.year||0)-Number(a.year||0)||a.index-b.index);
if(candidates.length>1&&candidates[0].similarity===candidates[1].similarity&&normaliseTitle(candidates[0].title)!==normaliseTitle(candidates[1].title))return -1;
if(requestedYear)return candidates[0].index;
const bestSimilarity=candidates[0].similarity;
const bestTitle=normaliseTitle(candidates[0].title);
const sameTitleCandidates=candidates.filter(movie=>movie.similarity===bestSimilarity&&normaliseTitle(movie.title)===bestTitle);
if(sameTitleCandidates.length<2)return candidates[0].index;
const storageKey='picksTitleMatch:'+slug;
let previousIndex=-1;
try{previousIndex=Number(sessionStorage.getItem(storageKey));}catch(error){}
const previousPosition=sameTitleCandidates.findIndex(movie=>movie.index===previousIndex);
const selected=sameTitleCandidates[(previousPosition+1)%sameTitleCandidates.length];
try{sessionStorage.setItem(storageKey,String(selected.index));}catch(error){}
return selected.index;
}

function resetPosterFlipCard(){
const card=document.getElementById('posterFlipCard');
const posterLink=document.getElementById('posterLink');
const menu=document.getElementById('movieSearchMenu');
if(card)card.classList.remove('is-flipped');
if(posterLink)posterLink.setAttribute('aria-expanded','false');
if(menu){
menu.setAttribute('aria-hidden','true');
menu.inert=true;
}
}

function scrollToTopAndWait(){
const synopsisArea=document.querySelector('.synopsis-scroll-area');
window.scrollTo({top:0,behavior:'smooth'});
if(synopsisArea)synopsisArea.scrollTo({top:0,behavior:'smooth'});
return new Promise(resolve=>{
let stableFrames=0;
const checkScroll=()=>{
const pageAtTop=window.scrollY<=1;
const synopsisAtTop=!synopsisArea||synopsisArea.scrollTop<=1;
if(pageAtTop&&synopsisAtTop){
stableFrames++;
if(stableFrames>=3){
resolve();
return;
}
}else{
stableFrames=0;
}
requestAnimationFrame(checkScroll);
};
requestAnimationFrame(checkScroll);
});
}

async function handleMovieUrlChange(){
const index=findMovieIndexFromHash();
if(index<0)return;
const slug=normaliseMovieUrl(index);
if(activeMovieSlug===slug)return;
activeMovieSlug=slug;
const navigationRequest=++historyNavigationRequest;
if(!watchedIndices.includes(index))watchedIndices.push(index);

updateDocumentTitle(false);
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
await scrollToTopAndWait();
resetPosterFlipCard();
overlay.classList.remove('no-light');
overlay.classList.add('loading-movie');
await new Promise(resolve=>setTimeout(resolve,300));
overlay.classList.remove('open');
await new Promise(resolve=>setTimeout(resolve,1000));
await new Promise(resolve=>setTimeout(resolve,300));
if(navigationRequest!==historyNavigationRequest)return;
await displayMovieAtIndex(index);
}

async function showNoMoviesToWatch(){
const overlay=document.getElementById('curtainOverlay');
const message=document.querySelector('#spotlightContent .spotlight-text');
stopSpeech();
await scrollToTopAndWait();
resetPosterFlipCard();
overlay.classList.remove('open','no-light','loading-movie');
updateDocumentTitle(false);
message.innerHTML='<span class="empty-library-title">No Movies to Watch</span><span class="empty-library-instructions">Add movies with a title and year to<br><code>movies-new.txt</code>, <code>movies-own.txt</code>, or <code>movies-fav.txt</code>.</span>';
document.getElementById('reloadBtn').style.display='none';
await new Promise(resolve=>setTimeout(resolve,600));
overlay.classList.add('show-spotlight');
}

async function showNoMoreMovies(){
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
await scrollToTopAndWait();
resetPosterFlipCard();
overlay.classList.remove('open','no-light','loading-movie');
updateDocumentTitle(false);
await new Promise(resolve=>setTimeout(resolve,600));
overlay.classList.add('show-spotlight');
document.getElementById('reloadBtn').style.display='none';
}

async function fetchNextMovie(isInitial=false){
const requestId=++nextMovieRequest;
if(watchedIndices.length>=movies.length){
await showNoMoreMovies();
return;
}

if(!isInitial){
updateDocumentTitle(false);
const overlay=document.getElementById('curtainOverlay');
stopSpeech();
resetPosterFlipCard();
await scrollToTopAndWait();
overlay.classList.remove('no-light');
overlay.classList.add('loading-movie');
await new Promise(resolve=>setTimeout(resolve,300));
overlay.classList.remove('open');
await new Promise(resolve=>setTimeout(resolve,1000));
await new Promise(resolve=>setTimeout(resolve,300));
}
if(requestId!==nextMovieRequest)return;

const chooseRandomMovie=()=>{
const candidates=movies.map((_,index)=>index).filter(index=>
!watchedIndices.includes(index)&&
index!==activeMovieIndex&&
index!==prefetchCandidateIndex
);
if(!candidates.length){
const remaining=movies.map((_,index)=>index).filter(index=>!watchedIndices.includes(index));
return remaining.length?remaining[Math.floor(Math.random()*remaining.length)]:-1;
}
return candidates[Math.floor(Math.random()*candidates.length)];
};

let nextIndex=prefetchedNextIndex!==null&&!watchedIndices.includes(prefetchedNextIndex)
?prefetchedNextIndex
:chooseRandomMovie();
if(nextIndex===-1&&prefetchCandidateIndex!==null&&!watchedIndices.includes(prefetchCandidateIndex)){
nextIndex=prefetchCandidateIndex;
}
if(nextIndex===prefetchedNextIndex)prefetchedNextIndex=null;

while(nextIndex>=0&&requestId===nextMovieRequest){
const index=nextIndex;
const parsed=parseMovieLine(movies[index]);
const slug=movieSlug(parsed.title,parsed.year);
const movieUrl=`#${slug.replace(/\s+/g,'_').replace(/%20/gi,'_')}`;

const displayAttempt=(async()=>{
await displayMovieAtIndex(index);
if(!document.getElementById('curtainOverlay').classList.contains('open')||activeMovieSlug!==slug)return false;
if(isInitial){
history.replaceState({movie:slug},'',movieUrl);
}else{
history.pushState({movie:slug},'',movieUrl);
}
if(!watchedIndices.includes(index))watchedIndices.push(index);
return true;
})();

const result=await Promise.race([
displayAttempt.catch(error=>{
console.error('Movie failed to load:',movies[index],error);
return false;
}),
new Promise(resolve=>setTimeout(()=>resolve(false),movieLoadTimeout))
]);

if(requestId!==nextMovieRequest)return;
if(result)return;

movieDisplayRequest++;
if(!watchedIndices.includes(index))watchedIndices.push(index);
if(prefetchedNextIndex===index)prefetchedNextIndex=null;

const overlay=document.getElementById('curtainOverlay');
overlay.classList.remove('open','no-light','loading-movie');
updateDocumentTitle(false);

if(watchedIndices.length>=movies.length){
await showNoMoreMovies();
return;
}

nextIndex=chooseRandomMovie();
}

if(requestId===nextMovieRequest&&watchedIndices.length>=movies.length){
await showNoMoreMovies();
}
}
async function copyMovieUrl(){
const url=`${location.origin}${location.pathname}${location.search}${location.hash.replace(/%20/gi,'_').replace(/ /g,'_')}`;
const button=document.getElementById('shareMovieBtn');
try{
if(navigator.clipboard&&window.isSecureContext){
await navigator.clipboard.writeText(url);
}else{
throw new Error('Clipboard API unavailable');
}
}catch(error){
const textarea=document.createElement('textarea');
textarea.value=url;
textarea.style.position='fixed';
textarea.style.opacity='0';
document.body.appendChild(textarea);
textarea.select();
let copied=false;
try{copied=document.execCommand('copy');}catch(copyError){}
textarea.remove();
if(!copied){
console.error('Could not copy movie URL:',error);
return;
}
}
const originalText='Share Movie';
button.textContent='Copied!';
setTimeout(()=>{if(button.textContent==='Copied!')button.textContent=originalText;},1500);
}

async function displayMovieAtIndex(randomIndex){
const requestId=++movieDisplayRequest;
const overlay=document.getElementById('curtainOverlay');
overlay.classList.add('loading-movie');
const parsed=parseMovieLine(movies[randomIndex]);
activeMovieIndex=randomIndex;
activeMovieSlug=movieSlug(parsed.title,parsed.year);
const title=parsed.title;
const year=parsed.year;

let movie=movieDetailsCache.get(randomIndex);
if(!movie){
movie=await fetchMovieDetails(title,year);
movieDetailsCache.set(randomIndex,movie);
}
if(requestId!==movieDisplayRequest)return;
currentMovie=movie;
const sourceBadge=document.getElementById('movieSourceBadge');
if(sourceBadge){
const sources=movieSources[randomIndex]||['movies-new.txt'];
const labels={'movies-new.txt':['U','New'],'movies-fav.txt':['F','Favourite'],'movies-own.txt':['O','Owned']};
const sourceCodes=['movies-new.txt','movies-fav.txt','movies-own.txt'].filter(file=>sources.includes(file));
const activeLetters={
U:sources.includes('movies-new.txt'),
F:sources.includes('movies-fav.txt'),
O:sources.includes('movies-own.txt')
};
sourceBadge.innerHTML=['U','F','O'].map(letter=>'<span class="source-letter'+(activeLetters[letter]?'':' inactive')+'">'+letter+'</span>').join('');
sourceBadge.setAttribute('aria-label',['U','F','O'].map(letter=>activeLetters[letter]?({U:'New',F:'Favourite',O:'Owned'})[letter]:null).filter(Boolean).join(' and ')+' movie list'+(sourceCodes.length>1?'s':''));
}
document.getElementById('movieTitle').innerText=currentMovie.title;
document.getElementById('movieYear').innerText=currentMovie.year;
document.dispatchEvent(new Event('picks:movie-changed'));
document.getElementById('movieSynopsis').innerText=currentMovie.synopsis;
document.getElementById('movieBlurb').innerText=currentMovie.blurb;
document.getElementById('movieBlurbSection').style.display=currentMovie.blurb?'':'none';
document.getElementById('moviePlotSummary').innerText=currentMovie.plotSummary||'';
document.getElementById('moviePlotSummarySection').hidden=!currentMovie.plotSummary;
document.getElementById('movieDetails').innerHTML=renderMovieDetails(currentMovie);
requestAnimationFrame(()=>requestAnimationFrame(updateSynopsisScrollHints));

await loadPoster(currentMovie);
if(requestId!==movieDisplayRequest)return;
const posterElement=document.getElementById('moviePoster');
const posterCard=document.getElementById('posterFlipCard');
const searchMenu=document.getElementById('movieSearchMenu');
posterCard?.classList.remove('is-flipped');
posterLink.setAttribute('aria-expanded','false');
searchMenu?.setAttribute('aria-hidden','true');
if(searchMenu)searchMenu.inert=true;
posterLink.setAttribute('aria-label',`Tap to search YouTube for ${title}${year?' '+year:''}`);
posterLink.title=`Tap to reveal YouTube searches for ${title}${year?' '+year:''}`;
const updatePosterLayout=()=>{
fitCardToPoster();
posterCard?.classList.toggle('has-wide-poster',Boolean(posterElement.naturalWidth&&posterElement.naturalHeight&&posterElement.naturalWidth/posterElement.naturalHeight>1.15));
};
posterElement.onload=updatePosterLayout;
posterElement.src=currentMovie.poster;
const searchPosterBackdrop=document.getElementById('searchPosterBackdrop');
if(searchPosterBackdrop)searchPosterBackdrop.src=currentMovie.poster;
if(posterElement.complete)updatePosterLayout();
document.getElementById('bgBackdrop').style.backgroundImage=`url('${currentMovie.poster}')`;

await new Promise(resolve=>setTimeout(resolve,150));
overlay.classList.remove('loading-movie');
overlay.classList.add('open');
updateDocumentTitle(true);
setTimeout(()=>overlay.classList.add('no-light'),1050);
prefetchNextMovie();
}


async function prefetchNextMovie(){
if(prefetchInProgress||prefetchedNextIndex!==null||!movies.length||watchedIndices.length>=movies.length)return;
const attempted=new Set();
const timeoutResult=Symbol('prefetch-timeout');
const maxPrefetchAttempts=Math.min(3,movies.length);
const task=(async()=>{
try{
while(attempted.size<maxPrefetchAttempts){
const candidates=movies.map((_,index)=>index).filter(index=>
!watchedIndices.includes(index)&&
index!==activeMovieIndex&&
!attempted.has(index)
);
if(!candidates.length)return;
const index=candidates[Math.floor(Math.random()*candidates.length)];
attempted.add(index);
prefetchCandidateIndex=index;
const attempt=(async()=>{
let movie=movieDetailsCache.get(index);
if(!movie){
const parsed=parseMovieLine(movies[index]);
movie=await fetchMovieDetails(parsed.title,parsed.year);
movieDetailsCache.set(index,movie);
}
if(movie.synopsis==='Synopsis currently unavailable.'&&movie.poster===fallbackPoster){
throw new Error('Movie details could not be found');
}
await loadPoster(movie);
return movie;
})();
try{
const movie=await Promise.race([
attempt,
new Promise(resolve=>setTimeout(()=>resolve(timeoutResult),movieLoadTimeout))
]);
if(movie===timeoutResult){
console.warn('Movie preloading timed out; trying another movie:',movies[index]);
if(prefetchCandidateIndex===index)prefetchCandidateIndex=null;
continue;
}
if(watchedIndices.includes(index)||index===activeMovieIndex){
if(prefetchCandidateIndex===index)prefetchCandidateIndex=null;
continue;
}
prefetchedNextIndex=index;
return;
}catch(error){
console.error('Movie preloading failed; trying another movie:',movies[index],error);
if(prefetchCandidateIndex===index)prefetchCandidateIndex=null;
}
}
}finally{
if(prefetchInProgress===task)prefetchInProgress=null;
if(prefetchCandidateIndex!==null&&prefetchedNextIndex!==prefetchCandidateIndex)prefetchCandidateIndex=null;
}
})();
prefetchInProgress=task;
await task;
}

function normaliseTitle(title){
const transliterations={
'æ':'ae',
'ǽ':'ae',
'œ':'oe',
'ß':'ss',
'ø':'o',
'ł':'l',
'đ':'d',
'ð':'d',
'þ':'th',
'ħ':'h',
'ı':'i'
};
return String(title||'')
.toLowerCase()
.replace(/[æǽœßøłđðþħı]/g,character=>transliterations[character]||character)
.normalize('NFD')
.replace(/[\u0300-\u036f]/g,'')
.replace(/&/g,'and')
.replace(/['’]/g,'')
.replace(/[^\p{L}\p{N}]+/gu,' ')
.replace(/\s+/g,' ')
.trim();
}

function titleWords(title){
return normaliseTitle(title).split(' ').filter(Boolean);
}

function titleSimilarity(a,b){
const x=normaliseTitle(a);
const y=normaliseTitle(b);

if(!x||!y)return 0;
if(x===y)return 1;

const ax=new Set(titleWords(a));
const bx=new Set(titleWords(b));
let common=0;

ax.forEach(word=>{
if(bx.has(word))common++;
});

return common/Math.max(ax.size,bx.size);
}

function getYearFromClaims(claims){
const claim=claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time;
if(!claim)return '';

const match=claim.match(/\+(\d{4})-/);
return match?match[1]:'';
}

function isFilmEntity(entity){
const description=(entity.description?.value||'').toLowerCase();

if(description.includes('film')||
description.includes('movie')||
description.includes('motion picture')||
description.includes('feature-length')){
return true;
}

const filmTypes=[
'Q11424',
'Q24869',
'Q29168811',
'Q202866',
'Q506240',
'Q18011172',
'Q93204',
'Q130232',
'Q229390'
];

const p31=entity.claims?.P31||[];

return p31.some(claim=>{
const id=claim.mainsnak?.datavalue?.value?.id;
return filmTypes.includes(id);
});
}

function getAliases(entity){
const aliases=[];

if(entity.aliases){
Object.values(entity.aliases).forEach(list=>{
list.forEach(item=>{
if(item.value)aliases.push(item.value);
});
});
}

return aliases;
}

function scoreWikidataEntity(entity,title,year){
if(!isFilmEntity(entity))return -100000;

const label=entity.labels?.en?.value||'';
const aliases=getAliases(entity);
const requested=normaliseTitle(title);

let score=0;

if(normaliseTitle(label)===requested)score+=1000;

aliases.forEach(alias=>{
if(normaliseTitle(alias)===requested)score+=950;
});

const bestLabelSimilarity=titleSimilarity(title,label);

if(bestLabelSimilarity===1)score+=500;
else score+=bestLabelSimilarity*300;

aliases.forEach(alias=>{
score=Math.max(score,titleSimilarity(title,alias)*280);
});

const entityYear=getYearFromClaims(entity.claims);

if(year){
if(entityYear===year)score+=800;
else if(entityYear)score-=700;
}

if(entity.sitelinks?.enwiki)score+=150;

if(entity.description?.value){
const description=entity.description.value.toLowerCase();

if(description.includes('film'))score+=100;
if(description.includes('american film'))score+=20;
if(description.includes('british film'))score+=20;
if(description.includes('french film'))score+=20;
if(description.includes('italian film'))score+=20;
if(description.includes('german film'))score+=20;
if(description.includes('czech film'))score+=20;
}

return score;
}

async function searchWikidata(title,year){
const cacheKey=`${title}|${year}`;

if(wikidataCache.has(cacheKey)){
return wikidataCache.get(cacheKey);
}

const languages=['en','fr','it','de','es','cs','ru'];
const searches=languages.map(language=>()=>fetch(
`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=${language}&uselang=en&type=item&limit=20&format=json&origin=*`
).then(response=>response.ok?response.json():null).catch(()=>null));

const responses=[];
for(let i=0;i<searches.length;i+=3){
responses.push(...await Promise.all(searches.slice(i,i+3).map(search=>search())));
}
const ids=new Set();

responses.forEach(data=>{
(data?.search||[]).forEach(result=>{
if(result.id)ids.add(result.id);
});
});

if(!ids.size){
wikidataCache.set(cacheKey,null);
return null;
}

const entityResponse=await fetch(
`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...ids].join('|')}&props=labels|aliases|claims|sitelinks&languages=en&sitefilter=enwiki&format=json&origin=*`
);

if(!entityResponse.ok){
wikidataCache.set(cacheKey,null);
return null;
}

const entityData=await entityResponse.json();
const entities=Object.values(entityData.entities||{});

entities.sort((a,b)=>scoreWikidataEntity(b,title,year)-scoreWikidataEntity(a,title,year));

const buildResult=(entity,entityYear)=>{
const wikipediaTitle=entity.sitelinks?.enwiki?.title;
if(!wikipediaTitle)return null;
return {
id:entity.id,
title:entity.labels?.en?.value||title,
year:entityYear||year||'',
wikipediaTitle,
claims:entity.claims||{}
};
};

// First pass: only accept candidates whose known release year matches the requested year.
for(const entity of entities){
const score=scoreWikidataEntity(entity,title,year);
if(score<500)continue;
const entityYear=getYearFromClaims(entity.claims);
if(year&&entityYear&&entityYear!==year)continue;
const result=buildResult(entity,entityYear);
if(!result)continue;
wikidataCache.set(cacheKey,result);
return result;
}

// Fallback: if no exact-year match exists, accept a high-confidence exact title/alias match.
// This handles films whose release year differs between reference sources.
const requestedTitle=normaliseTitle(title);
for(const entity of entities){
if(scoreWikidataEntity(entity,title,year)<500)continue;
const label=normaliseTitle(entity.labels?.en?.value||'');
const exactLabel=label===requestedTitle;
const exactAlias=getAliases(entity).some(alias=>normaliseTitle(alias)===requestedTitle);
if(!exactLabel&&!exactAlias)continue;
const result=buildResult(entity,getYearFromClaims(entity.claims));
if(!result)continue;
wikidataCache.set(cacheKey,result);
return result;
}

wikidataCache.set(cacheKey,null);
return null;
}

async function getWikipediaSummary(pageTitle){
if(wikipediaCache.has(pageTitle)){
return wikipediaCache.get(pageTitle);
}

try{
const response=await fetch(
`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
);

if(!response.ok){
wikipediaCache.set(pageTitle,null);
return null;
}

const data=await response.json();

if(data.type==='disambiguation'||!data.extract){
wikipediaCache.set(pageTitle,null);
return null;
}

wikipediaCache.set(pageTitle,data);
return data;
}catch(error){
console.error('Wikipedia summary error:',error);
wikipediaCache.set(pageTitle,null);
return null;
}
}

async function getWikipediaPlotSummary(pageTitle){
if(!pageTitle)return '';
if(plotSummaryCache.has(pageTitle))return plotSummaryCache.get(pageTitle);
try{
const sectionsUrl='https://en.wikipedia.org/w/api.php?action=parse&page='+encodeURIComponent(pageTitle)+'&prop=sections&format=json&origin=*';
const sectionsResponse=await fetch(sectionsUrl);
if(!sectionsResponse.ok){
plotSummaryCache.set(pageTitle,'');
return '';
}
const sectionsData=await sectionsResponse.json();
const sections=sectionsData.parse?.sections||[];
const plotSection=sections.find(section=>/^plot(?:\s|$)/i.test(section.line||''))||
sections.find(section=>/plot|synopsis/i.test(section.line||''));
if(!plotSection){
plotSummaryCache.set(pageTitle,'');
return '';
}
const textUrl='https://en.wikipedia.org/w/api.php?action=parse&page='+encodeURIComponent(pageTitle)+'&prop=text&section='+encodeURIComponent(plotSection.index)+'&format=json&origin=*';
const textResponse=await fetch(textUrl);
if(!textResponse.ok){
plotSummaryCache.set(pageTitle,'');
return '';
}
const textData=await textResponse.json();
const documentContent=new DOMParser().parseFromString(textData.parse?.text?.['*']||'','text/html');
documentContent.querySelectorAll('sup.reference,.mw-editsection,.navbox,table,style,script,.hatnote,.shortdescription,.metadata,.mw-empty-elt,.toc,.error,.mw-warning').forEach(element=>element.remove());
const paragraphs=[...documentContent.querySelectorAll('p')]
.map(paragraph=>paragraph.textContent.replace(/Cite error:[\s\S]*$/i,'').replace(/\[\d+\]/g,'').replace(/\s+/g,' ').trim())
.filter(paragraph=>paragraph.length>25&&!/^Cite error:/i.test(paragraph));
const plotSummary=paragraphs.join('\n\n').trim();
plotSummaryCache.set(pageTitle,plotSummary);
return plotSummary;
}catch(error){
console.error('Wikipedia plot summary error:',error);
plotSummaryCache.set(pageTitle,'');
return '';
}
}

async function searchWikipediaFallback(title,year){
const queries=[
`"${title}" ${year} film`,
`"${title}" film`,
`"${title}"`
];
let exactTitleYearFallback=null;

for(const query of queries){
try{
const response=await fetch(
`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=20&format=json&origin=*`
);

if(!response.ok)continue;

const data=await response.json();

for(const result of data.query?.search||[]){
const summary=await getWikipediaSummary(result.title);

if(!summary)continue;

const summaryTitle=summary.title||result.title;
const similarity=titleSimilarity(title,summaryTitle);
const summaryText=(summary.extract||'').toLowerCase();

if(similarity<0.85)continue;
if(!summaryText.includes('film')&&!summaryText.includes('movie'))continue;

const foundYears=summary.extract.match(/\b(19|20)\d{2}\b/g)||[];

if(year&&!foundYears.includes(year)&&result.title.match(/\b(19|20)\d{2}\b/)?.[0]!==year){
if(normaliseTitle(summaryTitle)===normaliseTitle(title)){
if(!exactTitleYearFallback)exactTitleYearFallback=summary;
continue;
}
continue;
}

return summary;
}
}catch(error){
console.error('Wikipedia search error:',error);
}
}

return exactTitleYearFallback;
}


function getTmdbApiKey(){
try{return (localStorage.getItem('picksTmdbApiKey')||'').trim();}catch(error){return '';}
}
async function tmdbRequest(path,apiKey){
const separator=path.includes('?')?'&':'?';
const response=await fetch('https://api.themoviedb.org/3'+path+separator+'api_key='+encodeURIComponent(apiKey));
if(!response.ok)throw new Error('TMDB request failed: HTTP '+response.status);
return response.json();
}
async function fetchMovieDetailsFromTmdb(title,year,apiKey){
try{
const searchPath='/search/movie?query='+encodeURIComponent(title)+'&include_adult=false&language=en-US'+(year?'&year='+encodeURIComponent(year):'');
const search=await tmdbRequest(searchPath,apiKey);
const results=(search.results||[]).map(result=>{
const resultYear=String(result.release_date||'').slice(0,4);
const similarity=titleSimilarity(title,result.title||result.original_title||'');
const yearMatch=!year||!resultYear||resultYear===year;
const score=similarity*100+(resultYear===year?45:0)+(result.original_language==='en'?2:0);
return {...result,resultYear,similarity,yearMatch,score};
}).filter(result=>result.similarity>=0.72&&result.yearMatch).sort((a,b)=>b.score-a.score);
if(!results.length)return null;
const match=results[0];
const [details,images]=await Promise.all([
tmdbRequest('/movie/'+match.id+'?language=en-US&append_to_response=credits',apiKey),
tmdbRequest('/movie/'+match.id+'/images?include_image_language=en,null',apiKey).catch(()=>({posters:[]}))
]);
const allPosters=(images.posters||[]).filter(image=>image.file_path).sort((a,b)=>{
const portraitA=a.height>a.width,portraitB=b.height>b.width;
if(portraitA!==portraitB)return portraitA?-1:1;
const langScore=image=>(image.iso_639_1==='en'?12:image.iso_639_1===null?8:0);
const qualityScore=image=>Math.min(image.vote_count||0,100)*0.08+(image.vote_average||0)*2;
const ratioScore=image=>Math.max(0,12-Math.abs((image.width/image.height)-0.667)*20);
return (langScore(b)+qualityScore(b)+ratioScore(b))-(langScore(a)+qualityScore(a)+ratioScore(a));
});
const posterUrl=image=>'https://image.tmdb.org/t/p/w500'+image.file_path;
const crew=details.credits?.crew||[];
const cast=details.credits?.cast||[];
const director=crew.find(person=>person.job==='Director')?.name||'';
const releaseYear=String(details.release_date||match.release_date||'').slice(0,4);
const overview=String(details.overview||match.overview||'').trim();
const tagline=String(details.tagline||'').trim();
const runtimeMinutes=Number(details.runtime)||0;
const runtime=runtimeMinutes?(runtimeMinutes>=60?Math.floor(runtimeMinutes/60)+' h '+runtimeMinutes%60+' min':runtimeMinutes+' min'):'';
const countries=(details.production_countries||[]).map(item=>item.name).filter(Boolean).slice(0,3);
const languages=(details.spoken_languages||[]).map(item=>item.english_name||item.name).filter(Boolean).slice(0,3);
const genres=(details.genres||[]).map(item=>item.name).filter(Boolean);
const fallbackPosterPaths=[details.poster_path,match.poster_path].filter(Boolean).map(path=>'https://image.tmdb.org/t/p/w500'+path);
const tmdbPosters=[...new Set([...allPosters.map(posterUrl),...fallbackPosterPaths])];
return {
title:details.title||match.title||title,
year:releaseYear||year||'N/A',
synopsis:overview||'Synopsis currently unavailable from TMDB.',
blurb:[tagline,overview].filter(Boolean).join('\n\n'),
tmdbTagline:tagline,
tmdbOverview:overview,
plotSummary:'',
details:{director,cast:cast.slice(0,8).map(person=>person.name).filter(Boolean),genre:genres,runtime,country:countries,language:languages},
poster:tmdbPosters[0]||fallbackPoster,
original:tmdbPosters[1]||null,
tmdbPosters,
tmdbId:details.id||match.id,
tmdbSource:true
};
}catch(error){
console.warn('TMDB lookup failed; using existing movie sources:',error);
return null;
}
}
async function fetchMovieDetails(title,year){
const apiKey=getTmdbApiKey();
if(!apiKey)return fetchMovieDetailsFromWikipedia(title,year);

// Run both providers together rather than waiting for TMDB before starting Wikipedia.
const wikipediaPromise=fetchMovieDetailsFromWikipedia(title,year).catch(()=>null);
const tmdbMovie=await fetchMovieDetailsFromTmdb(title,year,apiKey);
if(!tmdbMovie)return (await wikipediaPromise)||fetchMovieDetailsFromWikipedia(title,year);
const wikiMovie=await wikipediaPromise;
if(!wikiMovie){
return{
...tmdbMovie,
synopsis:tmdbMovie.tmdbOverview||'Synopsis currently unavailable.',
blurb:[tmdbMovie.tmdbTagline,tmdbMovie.tmdbOverview].filter(Boolean).join('\n\n'),
details:tmdbMovie.details||{},
wikiPosterCandidates:[]
};
}
const tagline=tmdbMovie.tmdbTagline||'';
const overview=tmdbMovie.tmdbOverview||'';
return{
...tmdbMovie,
title:wikiMovie.title||tmdbMovie.title,
year:wikiMovie.year||tmdbMovie.year,
synopsis:wikiMovie.synopsis||overview||'Synopsis currently unavailable.',
blurb:[tagline,overview].filter(Boolean).join('\n\n'),
plotSummary:wikiMovie.plotSummary||'',
details:wikiMovie.details||tmdbMovie.details||{},
wikiPosterCandidates:[wikiMovie.poster,wikiMovie.original,wikiMovie.wikidataPoster].filter(url=>url&&url!==fallbackPoster),
tmdbSource:true
};
}
async function fetchMovieDetailsFromWikipedia(title,year){
try{
const wikidata=await searchWikidata(title,year);

if(wikidata){
const summary=await getWikipediaSummary(wikidata.wikipediaTitle);

if(summary){
const [details,plotSummary]=await Promise.all([
getMovieDetails(wikidata),
getWikipediaPlotSummary(wikidata.wikipediaTitle)
]);
return{
title:title,
year:year||wikidata.year||'N/A',
synopsis:summary.extract,
blurb:buildMovieBlurb(summary.extract,plotSummary,title,year||wikidata.year),
plotSummary,
details,
poster:summary.thumbnail?.source||summary.originalimage?.source||fallbackPoster,
original:summary.originalimage?.source||null,
wikidataPoster:getWikidataPosterUrl(wikidata)
};
}
}
const fallback=await searchWikipediaFallback(title,year);

if(fallback){
const plotSummary=await getWikipediaPlotSummary(fallback.title);
return{
title:title,
year:year||'N/A',
synopsis:fallback.extract,
blurb:buildMovieBlurb(fallback.extract,plotSummary,title,year),
plotSummary,
details:{},
poster:fallback.thumbnail?.source||fallback.originalimage?.source||fallbackPoster,
original:fallback.originalimage?.source||null,
wikidataPoster:getWikidataPosterUrl(wikidata)
};
}
}catch(error){
console.error('Error fetching movie details:',error);
}

return{
title:title,
year:year||'N/A',
synopsis:'Synopsis currently unavailable.',
blurb:'Movie information currently unavailable.',
plotSummary:'',
details:{},
poster:fallbackPoster,
original:null
};
}

async function getWikidataEntityLabel(id){
if(!id)return '';
if(wikidataEntityCache.has(id))return wikidataEntityCache.get(id);
try{
const response=await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels&languages=en&format=json&origin=*`);
if(!response.ok)return '';
const data=await response.json();
const label=data.entities?.[id]?.labels?.en?.value||'';
wikidataEntityCache.set(id,label);
return label;
}catch(error){return '';}
}

function getClaimIds(claims,property){
return (claims?.[property]||[]).map(claim=>claim.mainsnak?.datavalue?.value?.id).filter(Boolean);
}

async function getMovieDetails(wikidata){
const claims=wikidata.claims||{};
const ids=[...new Set([
...getClaimIds(claims,'P57'),
...getClaimIds(claims,'P161'),
...getClaimIds(claims,'P136'),
...getClaimIds(claims,'P495'),
...getClaimIds(claims,'P364')
])];

let labels={};

if(ids.length){
try{
const response=await fetch(
`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=en&format=json&origin=*`
);
if(response.ok){
const data=await response.json();
Object.entries(data.entities||{}).forEach(([id,entity])=>{
labels[id]=entity.labels?.en?.value||'';
});
}
}catch(error){}
}

const list=property=>getClaimIds(claims,property).map(id=>labels[id]).filter(Boolean);
const runtimeClaim=claims.P2047?.[0]?.mainsnak?.datavalue?.value;
let runtime='';

if(runtimeClaim?.amount){
const value=Math.abs(Number(runtimeClaim.amount));
if(Number.isFinite(value)){
const minutes=Math.round(value);
runtime=minutes>=60?Math.floor(minutes/60)+' h '+minutes%60+' min':minutes+' min';
}
}

return{
director:list('P57').slice(0,1).join(''),
cast:list('P161').slice(0,5),
genre:formatGenres(list('P136').slice(0,3)),
country:list('P495').slice(0,2),
language:list('P364').slice(0,2),
runtime
};
}

function buildMovieBlurb(synopsis,plotSummary,title,year){
const cleanSource=source=>String(source||'')
.replace(/<[^>]*>/g,' ')
.replace(/\[\s*\d+\s*\]/g,'')
.replace(/\([^)]*(?:citation needed|verification needed|when\?)[^)]*\)/gi,'')
.replace(/\s+/g,' ')
.trim();

const splitSentences=source=>(cleanSource(source).match(/[^.!?]+[.!?]+(?:\s|$)/g)||[])
.map(sentence=>sentence.trim())
.filter(sentence=>sentence.length>20);

const metadata=/\b(?:is|was)\s+(?:an?|the)\s+(?:19|20)\d{2}\s+(?:American|British|Australian|Canadian|French|German|Italian|Spanish|Japanese|film|movie)\b|\b(?:film|movie)\s+(?:directed|written|produced)\b|\b(?:directed|written|produced)\s+by\b|\b(?:released|premiered|distributed)\b|\b(?:starring|stars|features)\b|\b(?:box office|award-winning|critical acclaim|production company)\b/i;
const story=/\b(?:after|when|while|once|as|but|until|before|during|whose|must|tries|attempts|sets out|travels|returns|discovers|finds|becomes|joins|seeks|searches|escapes|fights|battles|protects|survives|struggles|investigates|is sent|is tasked|is forced|is hired|is drawn|is caught|is stranded|is trapped|is pursued|is targeted|is recruited|is forced|sets off|embarks|faces|must find|must stop|must save|must escape|must uncover|falls in love|comes to|finds himself|finds herself|finds themselves|lives a|works as|dreams of|hopes to|plans to|trying to|in order to|in a world|on a mission|on the run|in search of|the story of)\b/i;
const ending=/\b(?:eventually|in the end|ultimately|finally|reveals that|turns out to be|is revealed to be|the final battle|the climactic|kills? (?:him|her|them|himself|herself)|dies? at the end|ends with|concludes with)\b/i;
const generic=/\b(?:the film|the movie|it was|it is|the production|the screenplay|the soundtrack|the cast|the director|the film's|the movie's)\b/i;

const rankSentences=source=>splitSentences(source)
.map((sentence,index)=>{
let score=0;
if(story.test(sentence))score+=4;
if(/\b(?:man|woman|boy|girl|family|detective|doctor|scientist|soldier|captain|prince|princess|king|queen|alien|monster|robot|criminal|stranger|couple|young|former|retired|lonely|small-town|widow|orphan|adventurer|agent|cop|police|astronaut|explorer|writer|artist|student|teacher|mother|father|brother|sister|child|children|people|group|crew|team)\b/i.test(sentence))score+=2;
if(/\b(?:mystery|secret|threat|danger|mission|journey|adventure|revenge|murder|disappearance|experiment|creature|invasion|war|crime|curse|treasure|survival|romance|love|escape|quest|conspiracy|disaster|haunted|strange|unexpected|supernatural)\b/i.test(sentence))score+=2;
if(metadata.test(sentence))score-=8;
if(ending.test(sentence))score-=6;
if(generic.test(sentence))score-=2;
if(sentence.length<45)score-=1;
if(sentence.length>300)score-=2;
return {sentence,score,index};
});

const makeBlurb=source=>{
const ranked=rankSentences(source);
if(!ranked.length)return '';
const viable=ranked.filter(item=>item.score>0);
if(!viable.length)return '';
const chosen=[];
let words=0;
for(const item of viable){
if(chosen.length>=3)break;
const count=item.sentence.split(/\s+/).length;
if(chosen.length&&words+count>85)continue;
if(chosen.length&&item.index>chosen[chosen.length-1].index+2)continue;
chosen.push(item);
words+=count;
if(words>=45)break;
}
if(!chosen.length)return '';
const ordered=chosen.sort((a,b)=>a.index-b.index).map(item=>item.sentence);
let result=ordered.join(' ').replace(/\s+/g,' ').trim();
if(result.length>560){
const cut=result.slice(0,557).lastIndexOf(' ');
result=result.slice(0,cut)+'...';
}
return result;
};

// Prefer the concise lead/overview, which usually establishes the premise before the full plot.
const overview=makeBlurb(synopsis);
if(overview)return overview;

// If the lead is mostly production information, use the opening plot paragraphs but avoid obvious ending-reveal sentences.
const plot=makeBlurb(plotSummary);
if(plot)return plot;

// Last resort: preserve the earlier sentence-selection behaviour for unusual or sparse articles.
const legacySource=cleanSource(plotSummary||synopsis);
const legacySentences=splitSentences(legacySource);
const legacyCandidates=legacySentences.filter(sentence=>!metadata.test(sentence));
const legacyStory=legacyCandidates.filter(sentence=>story.test(sentence));
const selected=legacyStory.length?legacyStory:legacyCandidates;
if(!selected.length)return '';
const chosen=[];
let wordCount=0;
for(const sentence of selected){
const count=sentence.split(/\s+/).length;
if(chosen.length&&wordCount+count>75)break;
chosen.push(sentence);
wordCount+=count;
if(wordCount>=40)break;
}
let blurb=chosen.join(' ').replace(/\s+/g,' ').trim();
if(blurb.length>520){
const cut=blurb.slice(0,517).lastIndexOf(' ');
blurb=blurb.slice(0,cut)+'...';
}
return blurb;
}

function genreArticle(genre){
const word=genre.trim().toLowerCase();
return /^(honest|honour|hour|heir|heirloom|herb)\b/.test(word)||/^[aeiou]/.test(word)?'an':'a';
}

function formatGenres(genres){
const clean=[...new Set(genres.map(genre=>genre.replace(/\s+film$/i,'').trim()).filter(Boolean))];
return clean;
}


function renderMovieDetails(movie){
const d=movie.details||{};
const rows=[];
const add=(label,value)=>{if(value)rows.push(`<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`);};
add('Director',d.director);
add('Cast',d.cast?.join(', '));
add('Genre',d.genre?.join(' · '));
add('Runtime',d.runtime);
add('Released',movie.year&&movie.year!=='N/A'?movie.year:'');
add('Country',d.country?.join(' · '));
add('Language',d.language?.join(' · '));
if(movie.tmdbSource)rows.push('<div class="tmdb-attribution"><span class="tmdb-attribution-label">TMDB Credits</span><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer"><img src="https://www.themoviedb.org/assets/2/v4/logos/blue_long_2.svg" alt="The Movie Database (TMDB)" loading="lazy"></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div>');
if(movie.tmdbSource)rows.push('<div class="tmdb-attribution">This product uses the TMDB API but is not endorsed or certified by TMDB.</div>');
return rows.length?rows.join(''):'<div class="detail-row"><span class="detail-value">Additional details unavailable.</span></div>';
}

function updateSynopsisScrollHints(){
const shell=document.querySelector('.synopsis-scroll-shell');
const area=document.querySelector('.synopsis-scroll-area');
if(!shell||!area)return;
if(window.innerWidth<768){
shell.classList.remove('has-more-above','has-more-below');
return;
}
const maxScroll=area.scrollHeight-area.clientHeight;
shell.classList.toggle('has-more-above',area.scrollTop>2);
shell.classList.toggle('has-more-below',maxScroll-area.scrollTop>2);
}

const synopsisArea=document.querySelector('.synopsis-scroll-area');
if(synopsisArea){
synopsisArea.addEventListener('scroll',updateSynopsisScrollHints,{passive:true});
window.addEventListener('resize',updateSynopsisScrollHints);
if('ResizeObserver' in window){
const synopsisResizeObserver=new ResizeObserver(updateSynopsisScrollHints);
synopsisResizeObserver.observe(synopsisArea);
const synopsisShell=synopsisArea.closest('.synopsis-scroll-shell');
if(synopsisShell)synopsisResizeObserver.observe(synopsisShell);
}
window.addEventListener('load',updateSynopsisScrollHints);
}

function fitCardToPoster(){
const card=document.querySelector('.content-card');
const poster=document.getElementById('moviePoster');
const container=document.querySelector('.poster-container');

if(!card||!poster||!container)return;

if(window.innerWidth<768||!poster.naturalWidth||!poster.naturalHeight){
card.style.height='';
container.classList.remove('has-landscape-fill');
container.style.removeProperty('--poster-image');
return;
}

const posterWidth=container.clientWidth;
const posterHeight=posterWidth*poster.naturalHeight/poster.naturalWidth;
const isWide=poster.naturalWidth/poster.naturalHeight>1.15;
const cardHeight=isWide?Math.max(560,posterHeight):posterHeight;

card.style.height=`${cardHeight}px`;
container.classList.toggle('has-landscape-fill',isWide);

if(isWide){
container.style.setProperty('--poster-image',`url("${poster.currentSrc||poster.src}")`);
}else{
container.style.removeProperty('--poster-image');
}
}

window.addEventListener('resize',fitCardToPoster);


const commonsPosterCache=new Map();

async function findCommonsPosters(title,year){
const cacheKey=normaliseTitle(title)+'|'+year;
if(commonsPosterCache.has(cacheKey))return commonsPosterCache.get(cacheKey);
const searches=[`"${title}" ${year} film poster`,`"${title}" movie poster`];
const candidates=new Map();
for(const search of searches){
try{
const url='https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch='+encodeURIComponent('filetype:bitmap '+search+' poster')+'&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|size&iiurlwidth=900&format=json&origin=*';
const response=await fetch(url);
if(!response.ok)continue;
const data=await response.json();
Object.values(data.query?.pages||{}).forEach(page=>{
const info=page.imageinfo?.[0];
if(!info||!info.width||!info.height)return;
const filename=(page.title||'').replace(/^File:/i,'');
if(!/poster|theatrical|affiche|one.sheet/i.test(filename))return;
const titleScore=titleSimilarity(title,filename);
const hasYear=Boolean(year&&filename.includes(year));
const score=titleScore*100+(hasYear?25:0);
if(titleScore<0.45)return;
const imageUrl=info.thumburl||info.url;
if(!imageUrl)return;
const existing=candidates.get(imageUrl);
if(!existing||existing.score<score)candidates.set(imageUrl,{url:imageUrl,score,width:info.width,height:info.height});
});
}catch(error){}
}
const ranked=[...candidates.values()].sort((a,b)=>b.score-a.score);
commonsPosterCache.set(cacheKey,ranked);
return ranked;
}

function getWikidataPosterUrl(wikidata){
const filename=wikidata?.claims?.P3383?.[0]?.mainsnak?.datavalue?.value;
if(!filename||typeof filename!=='string')return '';
return 'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(filename.replace(/^File:/i,''));
}


async function loadPoster(movie){
const loadImage=url=>new Promise(resolve=>{
const img=new Image();
img.onload=()=>resolve({url:img.currentSrc||img.src,width:img.naturalWidth,height:img.naturalHeight});
img.onerror=()=>resolve(null);
img.src=url;
});
const isValidUrl=url=>Boolean(url&&url!==fallbackPoster);
const tmdbCandidates=[...(movie.tmdbPosters||[]),...(movie.tmdbPosters?.length?[]:[movie.tmdbPoster])].filter(isValidUrl);
const wikiCandidates=(movie.tmdbSource
?movie.wikiPosterCandidates||[]
:[movie.poster,movie.original,movie.wikidataPoster]).filter(isValidUrl);
const tested=new Map();
const testImage=async url=>{
if(!tested.has(url))tested.set(url,await loadImage(url));
return tested.get(url);
};
const findImage=async (group,portraitOnly)=>{
for(const url of group){
const image=await testImage(url);
if(image&&image.width>0&&image.height>0&&(!portraitOnly||image.height>image.width))return image;
}
return null;
};

// Prefer portrait artwork from Wikipedia/Wikidata/Commons before considering TMDB.
let selected=await findImage(wikiCandidates,true);
if(!selected){
const commonsTimeout=Symbol('commons-timeout');
const commons=await Promise.race([
findCommonsPosters(movie.title||'',movie.year||''),
new Promise(resolve=>setTimeout(()=>resolve(commonsTimeout),1800))
]);
if(commons!==commonsTimeout){
movie.commonsPosterCandidates=commons.map(candidate=>candidate.url);
selected=await findImage(movie.commonsPosterCandidates,true);
}
}
if(selected){movie.poster=selected.url;movie.original=null;return;}

// TMDB portrait artwork is only a backup when no Wiki portrait is available.
selected=await findImage(tmdbCandidates,true);
if(selected){movie.poster=selected.url;movie.original=null;return;}

// No portrait poster found: try any Wiki image (wide or square) before TMDB.
selected=await findImage([...wikiCandidates,...(movie.commonsPosterCandidates||[])],false);
if(selected){movie.poster=selected.url;movie.original=null;return;}
selected=await findImage(tmdbCandidates,false);
if(selected){movie.poster=selected.url;movie.original=null;return;}
movie.poster=fallbackPoster;
movie.original=null;
}
function yearToSpeech(year){
const value=Number(year);
if(!Number.isInteger(value)||value<1000||value>2099)return year;
const small=['zero','one','two','three','four','five','six','seven','eight','nine'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const underHundred=n=>n<10?small[n]:n<20?['ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'][n-10]:tens[Math.floor(n/10)]+(n%10?'-'+small[n%10]:'');
if(value<2000){
const century=Math.floor(value/100);
const remainder=value%100;
const centuryWord=underHundred(century);
if(!remainder)return centuryWord+' hundred';
if(remainder<10)return centuryWord+' oh '+small[remainder];
return centuryWord+' '+underHundred(remainder);
}
if(value<2010){
const remainder=value%2000;
return remainder===0?'two thousand':'two thousand '+underHundred(remainder);
}
return 'twenty '+underHundred(value%2000-0);
}

function prepareSpeechText(text){
return String(text||'').replace(/\b(?:1[0-9]{3}|20[0-9]{2})\b/g,match=>yearToSpeech(match));
}

function speakTexts(items){
if(!('speechSynthesis' in window)){
alert('Text-to-speech is not supported in your browser.');
return;
}
if(isSpeaking){
stopSpeech();
return;
}
const parts=[];
const pauses=[];
items.forEach(item=>{
if(item.text){
parts.push(item.text);
pauses.push(item.delay??250);
}
});
if(!parts.length)return;
isSpeaking=true;
let index=0;
const speakNext=()=>{
if(!isSpeaking||index>=parts.length){
isSpeaking=false;
return;
}
const utterance=new SpeechSynthesisUtterance(prepareSpeechText(parts[index++]));
utterance.rate=1;
utterance.onend=()=>{
if(!isSpeaking)return;
speechTimeout=setTimeout(speakNext,pauses[index-1]??250);
};
window.speechSynthesis.speak(utterance);
};
speakNext();
}

function speakMovieIntro(){
if(isSpeaking){
stopSpeech();
return;
}
const title=currentMovie.title||'';
const year=currentMovie.year&&currentMovie.year!=='N/A'?currentMovie.year:'';
const genres=currentMovie.details?.genre||[];
const items=[];
const addSpeech=(text,delay=250)=>{if(text)items.push({text,delay});};
addSpeech(year?'released '+year:'');
addSpeech(title);
if(genres.length===1){
addSpeech('is '+genreArticle(genres[0])+' '+genres[0]+' film');
}else if(genres.length>1){
addSpeech('is '+genreArticle(genres[0])+' '+genres[0],genres.length===2?0:125);
genres.slice(1,-1).forEach((genre,i,items)=>addSpeech(genre,i===items.length-1?0:125));
addSpeech('and '+genres[genres.length-1]+' film',250);
}
speakTexts(items);
}

function speakMovieSection(section){
if(isSpeaking){
stopSpeech();
return;
}
if(section==='movieBlurb'&&(currentMovie.tmdbTagline||currentMovie.tmdbOverview)){
speakTexts([
{text:currentMovie.tmdbTagline||'',delay:750},
{text:currentMovie.tmdbOverview||'',delay:250}
]);
return;
}
const text=document.getElementById(section)?.innerText?.trim();
if(text)speakTexts([{text,delay:250}]);
}

function setupMovieTitleClipboard(){
const title=document.getElementById('movieTitle');
if(!title)return;
title.style.cursor='pointer';
title.title='Tap or click to copy movie title and year';
title.setAttribute('aria-label','Copy movie title and year to clipboard');
title.addEventListener('click',async()=>{
const movieTitle=currentMovie?.title||title.textContent.trim();
const year=currentMovie?.year||document.getElementById('movieYear')?.textContent.trim()||'';
if(!movieTitle||movieTitle==='Loading...')return;
const text=[movieTitle,year&&year!=='N/A'?year:''].filter(Boolean).join(' ');
try{
await navigator.clipboard.writeText(text);
}catch(error){
const textarea=document.createElement('textarea');
textarea.value=text;
textarea.setAttribute('readonly','');
textarea.style.position='fixed';
textarea.style.opacity='0';
document.body.append(textarea);
textarea.select();
const copied=document.execCommand('copy');
textarea.remove();
if(!copied)console.warn('Could not copy movie title and year to clipboard.');
}
});
}

function setupMovieSpeech(){
const details=document.getElementById('movieDetails');
if(details){
details.addEventListener('click',event=>{
if(event.target.closest('a,button,input,select,textarea,summary'))return;
speakMovieIntro();
});
details.setAttribute('tabindex','0');
details.setAttribute('role','button');
details.setAttribute('aria-label','Read movie title, year and introductory details aloud');
details.addEventListener('keydown',event=>{
if(event.target!==details)return;
if(event.key==='Enter'||event.key===' '){
event.preventDefault();
speakMovieIntro();
}
});
}
['movieBlurb','movieSynopsis','moviePlotSummary'].forEach(id=>{
const element=document.getElementById(id);
if(!element)return;
element.addEventListener('click',()=>speakMovieSection(id));
element.setAttribute('tabindex','0');
element.setAttribute('role','button');
element.setAttribute('aria-label','Read '+(id==='movieBlurb'?'movie blurb':id==='movieSynopsis'?'synopsis':'plot summary')+' aloud');
element.addEventListener('keydown',event=>{
if(event.key==='Enter'||event.key===' '){
event.preventDefault();
speakMovieSection(id);
}
});
});
}



function stopSpeech(){
if('speechSynthesis' in window)window.speechSynthesis.cancel();
if(speechTimeout){
clearTimeout(speechTimeout);
speechTimeout=null;
}
isSpeaking=false;
}


function setupMobileActionLabels(){
const nextButton=document.getElementById('reloadBtn');
const shareButton=document.getElementById('shareMovieBtn');
const mobile=window.matchMedia('(max-width: 767px)');
const updateLabels=()=>{
nextButton.textContent=mobile.matches?'Next':'Next Movie';
shareButton.textContent=mobile.matches?'Share':'Share Movie';
};
updateLabels();
mobile.addEventListener('change',updateLabels);
}

window.onload=()=>{
setupMobileActionLabels();
setupMovieSpeech();
setupMovieTitleClipboard();
loadMoviesDatabase();
};
