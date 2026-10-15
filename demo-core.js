'use strict';
// The browser build only uses synthetic weights and never emits advertising events.
globalThis.PilotCore = (() => {
  const features=['pageviews','active_seconds','product_views','cart_adds','checkout_starts','return_visits','scroll_depth'];
  const limits=[100,7200,100,30,20,30,100];
  const names=['Просмотры','Активное время','Просмотры товаров','Корзина','Начало оформления','Повторные визиты','Глубина просмотра'];
  const sigmoid=x=>1/(1+Math.exp(-Math.max(-35,Math.min(35,x))));
  function score(row,model=null,{margin=.3,base_rate=.03,aov=5000}={}) {
    if(![margin,base_rate,aov].every(Number.isFinite)||margin<0||margin>1||base_rate<.0001||base_rate>.99||aov<0||aov>1e9)
      throw new Error('Некорректные бизнес-параметры');
    const x=features.map((k,i)=>{
      const v=row?.[k];
      if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>limits[i]) throw new Error('Нужны семь числовых признаков в допустимых границах');
      return Math.log1p(v);
    });
    let contributions,p,drift=false,mode='heuristic';
    if(model){
      if(model.kind!=='synthetic'||model.version!==1)throw new Error('Публичная версия принимает только демонстрационную модель');
      const z=x.map((v,i)=>(v-model.mean[i])/model.sd[i]);
      contributions=z.map((v,i)=>v*model.weights[i+1]*model.calibrator[1]);
      p=sigmoid(model.calibrator[0]+model.calibrator[1]*(model.weights[0]+z.reduce((s,v,i)=>s+v*model.weights[i+1],0)));
      const [lo,hi]=model.reference_quantiles;
      drift=x.filter((v,i)=>v<lo[i]-.15||v>hi[i]+.15).length>=2;
      aov=model.aov;mode='synthetic';
    }else{
      const weights=[.22,.12,.3,.65,.85,.2,.06];contributions=x.map((v,i)=>v*weights[i]);
      p=sigmoid(Math.log(base_rate/(1-base_rate))+contributions.reduce((s,v)=>s+v,0));
    }
    const round=n=>Math.round((n+Number.EPSILON)*100)/100;
    const explanations=contributions.map((effect,i)=>({feature:names[i],effect:Math.round(effect*1000)/1000,index:i}))
      .sort((a,b)=>Math.abs(b.effect)-Math.abs(a.effect)||b.index-a.index).slice(0,3).map(({feature,effect})=>({feature,effect}));
    return {probability:p,expected_revenue:round(p*aov),expected_margin:round(p*aov*margin),conditional_aov:round(aov),mode,
      drift_warning:drift,quality_passed:false,advertising_export_enabled:false,explanations,
      recommendation:drift?'Необычные признаки относительно демонстрационных данных. Рекламный экспорт отключён.':
        'Демонстрационный расчёт: не использовать для рекламных ставок. Качество на вашем бизнесе не измерено.'};
  }
  function assistant(question,p,model){
    if(typeof question!=='string'||question.length>2000)throw new Error('Запрос должен быть текстом до 2000 символов');
    const q=question.toLowerCase();
    if(/прибыл|марж|ценност|выруч|чек/.test(q))return 'Ожидаемая выручка = вероятность конверсии × средний чек покупателей. Маржа до рекламы = ожидаемая выручка × доля маржи. Это не чистая прибыль: вычитайте стоимость привлечения, возвраты и остальные расходы. Чек этой модели — среднее покупателей на синтетической обучающей выборке.';
    if(/метрик|директ|реклам|google|подключ/.test(q))return 'Публичная демонстрация не подключена к рекламным кабинетам и не отправляет цели. В рабочем проекте прогнозы должны учитываться отдельной целью modeled_conversion_v1, а реальные покупки — отдельно. Начните с наблюдения, затем проведите контролируемый эксперимент по реальной прибыли. В Google Ads secondary в custom goal может участвовать в ставках.';
    if(/обуч|csv|данн|качеств|точност/.test(q)){
      if(!model)return 'Сейчас активна экспертная эвристика без измеренной точности. На вкладке «Модель и проверка» можно включить готовую синтетическую модель. Обучение на реальном CSV доступно в отдельном локальном приложении Python; эта веб-демонстрация не принимает ваши файлы.';
      const m=model.quality;
      return `Демонстрационная модель: ROC-AUC ${m.roc_auc.toFixed(3)}, PR-AUC ${m.pr_auc.toFixed(3)}, Brier ${m.brier.toFixed(4)}, lift ${m.lift_top10.toFixed(2)}. Тест: ${m.n} синтетических сессий. Это не доказательство качества на реальном бизнесе. Обучение уже выполнено локально; сайт загружает готовые веса и отчёт, а не переобучает модель.`;
    }
    if(/прогноз|почему|визит|оцен|анализ/.test(q))return `Сценарий: ${(p.probability*100).toFixed(1)}%, ожидаемая выручка ${p.expected_revenue.toFixed(0)} ₽, маржа до рекламы ${p.expected_margin.toFixed(0)} ₽. Режим: ${p.mode==='synthetic'?'синтетическая модель':'экспертная эвристика'}. Сильнее всего влияют: ${p.explanations.map(x=>x.feature).join(', ')}. Вклад признака не доказывает причинную связь. ${p.recommendation}`;
    if(/тест|эксперимент|рост|лучш/.test(q))return 'Сравните контроль с текущей рекламной стратегией и тест с отдельной моделируемой целью. До старта зафиксируйте случайное разделение аудитории, окно сделки, минимально полезный эффект, размер выборки и правило остановки. Основная метрика — фактическая прибыль после рекламы; дополнительные — CAC, возвраты и качество лидов. Синтетические метрики этой страницы не подтверждают прирост продаж.';
    return 'Это сценарный помощник без внешней языковой модели. Я объясняю прогноз, качество модели, экономику, рекламные интеграции и план эксперимента. Расчёты и ответы выполняются в вашем браузере; обучение реальным данным и рекламная отправка здесь недоступны.';
  }
  return Object.freeze({score,assistant,features});
})();
