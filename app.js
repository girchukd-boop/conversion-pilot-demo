'use strict';
const $ = id => document.getElementById(id);
const fields = ['pageviews','active_seconds','product_views','cart_adds','checkout_starts','return_visits','scroll_depth'];
const labels = ['Просмотры страниц','Активное время, сек.','Просмотры товаров','Добавления в корзину','Начало оформления','Повторные визиты','Глубина просмотра, %'];
const maxima = [100,7200,100,30,20,30,100];
const presets = {research:[6,180,3,0,0,1,65], cold:[1,12,0,0,0,0,15],hot:[12,420,7,2,1,3,95]};
const modes = {heuristic:'Экспертная эвристика',synthetic:'Синтетическая модель',project:'Модель проекта'};
let state = {model:null};
const money = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function notice(text,error=false){$('notice').textContent=text;$('notice').style.color=error?'#efc27b':'var(--accent)';}
let browserModel;
let modelPromise;
async function getDemoModel(){
  if(!modelPromise)modelPromise=fetch('./demo-model.json').then(r=>{if(!r.ok)throw new Error('Не удалось загрузить демонстрационную модель');return r.json();}).then(m=>{if(m.kind!=='synthetic'||m.quality_passed!==false)throw new Error('Неверный тип демонстрационной модели');return m;}).catch(e=>{modelPromise=null;throw e;});
  return modelPromise;
}
async function api(path,data){
  const demoModel=await getDemoModel();
  if(browserModel===undefined)browserModel=demoModel;
  if(path==='/api/status')return {model:browserModel};
  if(path==='/api/score')return PilotCore.score(data.features,browserModel,data);
  if(path==='/api/demo'){browserModel=demoModel;return {model:browserModel};}
  if(path==='/api/reset'){browserModel=null;return {model:null};}
  if(path==='/api/assistant')return {answer:PilotCore.assistant(data.question,PilotCore.score(data.features,browserModel,data),browserModel)};
  throw new Error('Функция недоступна в публичной демонстрации');
}
function openTab(name){
  document.querySelectorAll('.tab').forEach(e=>e.classList.toggle('active',e.id===name));
  document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.tab===name));
  $('title').textContent={overview:'Обзор модели',sandbox:'Песочница',training:'Модель и проверка',assistant:'Аналитический ассистент'}[name];
}
document.querySelectorAll('[data-tab]').forEach(e=>e.addEventListener('click',()=>openTab(e.dataset.tab)));
document.querySelectorAll('[data-open]').forEach(e=>e.addEventListener('click',()=>openTab(e.dataset.open)));
fields.forEach((key,i)=>{
  const row=element('div',undefined,'slider-row'),label=element('label',labels[i]);label.htmlFor=key;
  const value=element('output');value.id=key+'Value';value.setAttribute('for',key);label.append(value);
  const input=element('input');input.type='range';input.id=key;input.min='0';input.max=String(maxima[i]);input.step='1';
  input.addEventListener('input',()=>{value.textContent=input.value;});row.append(label,input);$('sliders').append(row);
});
function applyPreset(){presets[$('preset').value].forEach((v,i)=>{$(fields[i]).value=v;$(fields[i]+'Value').textContent=v;});}
$('preset').addEventListener('change',applyPreset);applyPreset();
function payload(){return {features:Object.fromEntries(fields.map(k=>[k,Number($(k).value)])),margin:Number($('margin').value)/100,base_rate:Number($('base_rate').value)/100,aov:Number($('aov').value)};}
function renderScore(p){
  $('prob').replaceChildren(document.createTextNode((p.probability*100).toFixed(1)),element('span','%'));
  $('scoreMode').textContent=modes[p.mode]+(p.mode==='heuristic'?' · НЕ КАЛИБРОВАНА':'');
  $('revenue').textContent=money(p.expected_revenue);$('profit').textContent=money(p.expected_margin);
  $('explanations').replaceChildren(...p.explanations.map(x=>{const r=element('div',undefined,'influence');r.append(element('span',x.feature),element('span',(x.effect>=0?'+':'')+x.effect.toFixed(2)));return r;}));
  $('recommendation').textContent=p.recommendation;
}
async function calculate(){try{renderScore(await api('/api/score',payload()));}catch(e){notice(e.message,true);}}
$('scoreForm').addEventListener('submit',e=>{e.preventDefault();calculate();});
const checkNames={brier_better:'Brier лучше базового',log_loss_better:'Log loss лучше базового',positive_lift:'Lift выше 1',positive_calibration_slope:'Положительный наклон калибровки',real_data:'Не синтетические данные'};
function renderState(){
  const m=state.model;
  $('modelMode').textContent=m?(m.kind==='synthetic'?'Демонстрация':'Обученная'):'Стартовый';
  $('modelNote').textContent=m?(m.kind==='synthetic'?'Только синтетические данные':'Данные загруженного проекта'):'Экспертная эвристика';
  $('auc').textContent=m?m.quality.roc_auc.toFixed(3):'—';$('lift').textContent=m?m.quality.lift_top10.toFixed(2)+'×':'—';$('testN').textContent=m?m.quality.n:'—';
  $('gate').textContent=m?.quality_passed?'ТЕСТ ПРОЙДЕН':'НАБЛЮДЕНИЕ';
  if(!m){$('quality').replaceChildren(element('p','У стартовой эвристики нет измеренной точности. Включите готовую синтетическую модель на вкладке «Модель и проверка».'));$('report').textContent='Активна экспертная эвристика без измеренной точности. Демонстрационную модель можно включить кнопкой выше.';return;}
  const checks=element('div',undefined,'checks');
  Object.entries(m.checks).forEach(([key,ok])=>{const row=element('div',undefined,'check');row.append(element('span',checkNames[key]),element('span',ok?'✓ Пройдено':'○ Не пройдено'));checks.append(row);});
  $('quality').replaceChildren(checks,element('p',m.quality_passed?'Проверки позволяют перейти к контролируемому эксперименту. Рекламный экспорт остаётся выключенным.':'Модель остаётся в теневом режиме. Отправка рекламных целей выключена.'));
  const meta=element('p',`Обучение: ${m.train_n} · Калибровка: ${m.calibration_n} · Тест: ${m.quality.n} · Незрелых исключено: ${m.excluded_immature} · Пересечений исключено: ${m.excluded_overlap}`,'report-meta');
  const table=element('table'),head=element('tr');['Метрика','Модель','Базовая частота'].forEach(t=>head.append(element('th',t)));table.append(head);
  [['ROC-AUC','roc_auc'],['PR-AUC (average precision)','pr_auc'],['Brier ↓','brier'],['Log loss ↓','log_loss'],['Lift · верхние 10%','lift_top10']].forEach(([name,key])=>{const tr=element('tr');[name,m.quality[key].toFixed(4),m.baseline[key].toFixed(4)].forEach(v=>tr.append(element('td',v)));table.append(tr);});
  const calibration=element('table'),ch=element('tr');['Калибровка: прогноз','Фактическая частота','Сессий'].forEach(t=>ch.append(element('th',t)));calibration.append(ch);
  m.quality.calibration.forEach(b=>{const r=element('tr');[(b.predicted*100).toFixed(1)+'%',(b.actual*100).toFixed(1)+'%',b.n].forEach(v=>r.append(element('td',String(v))));calibration.append(r);});
  $('report').replaceChildren(element('p',m.kind==='synthetic'?'СИНТЕТИЧЕСКАЯ ДЕМОНСТРАЦИЯ. Результаты не подтверждают эффективность для реальных посетителей.':'Независимый от обучения будущий период; показатели относятся только к этой выборке.',m.kind==='synthetic'?'warning':'pass'),meta,table,element('p',`Средний чек покупателей в обучении: ${money(m.aov)}. MAE чека на тестовых покупателях: ${money(m.quality.order_value_mae)}.`,'report-meta'),element('h3','Калибровка на тестовом периоде'),calibration,element('p','Интерпретация: среди сессий с прогнозом около 20% примерно 20% должны завершаться конверсией. Малые группы дают нестабильную оценку.','report-meta'));
}
$('demo').addEventListener('click',async()=>{try{state=await api('/api/demo',{});renderState();await calculate();notice('Включена готовая синтетическая модель. Обучение на сайте не выполнялось.');}catch(e){notice(e.message,true);}});
$('reset').addEventListener('click',async()=>{try{state=await api('/api/reset',{});renderState();await calculate();notice('Активна экспертная эвристика. Рекламный экспорт отключён.');}catch(e){notice(e.message,true);}});
async function ask(text){
  const messages=$('messages');messages.append(element('div',text,'message user'));const reply=element('div','Анализирую…','message bot');messages.append(reply);messages.scrollTop=messages.scrollHeight;
  try{const r=await api('/api/assistant',{question:text,...payload()});reply.textContent=r.answer;}catch(e){reply.textContent=e.message;}messages.scrollTop=messages.scrollHeight;
}
document.querySelectorAll('[data-question]').forEach(e=>e.addEventListener('click',()=>ask(e.dataset.question)));
$('chatForm').addEventListener('submit',e=>{e.preventDefault();const q=$('question').value.trim();if(q){$('question').value='';ask(q);}});
(async()=>{try{state=await api('/api/status');renderState();await calculate();}catch(e){notice(e.message,true);}})();
