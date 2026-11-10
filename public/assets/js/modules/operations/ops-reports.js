/* Operations Head Reports only; other roles keep the shared reporting screen. */
'use strict';
const OpsReportsUI = {
  analytics(ctx, original) {
    // Reuse the original analytics renderer verbatim: calculations, content and print closures stay there.
    ctx.el.classList.add('oh-analytics');
    ctx.tools?.closest('.page-head')?.classList.add('oh-analytics-head');
    original.call(App.pages.reports,ctx);
    const [periods,filters,workspace]=ctx.el.children;
    if(!periods||!filters||!workspace)return;
    const controls=document.createElement('section');controls.className='panel oh-analytics-controls';
    controls.innerHTML='<div class="panel-head"><h2 class="panel-title">Report Controls</h2></div><div class="panel-body"><div class="oh-analytics-control-row"></div><div class="oh-analytics-filter-summary"></div></div>';
    const action=document.createElement('div');action.dataset.fid=filters.dataset.fid;action.className='oh-analytics-filter-action';
    const filterButton=filters.querySelector('[data-fopen]');if(filterButton)action.append(filterButton);
    ctx.el.prepend(controls);controls.querySelector('.oh-analytics-control-row').append(periods,action);controls.querySelector('.oh-analytics-filter-summary').append(filters);
    periods.classList.add('oh-analytics-periods');workspace.classList.add('oh-analytics-workspace');
    const tabs=workspace.querySelector(':scope > [role=tablist]'),body=workspace.querySelector(':scope > .tab-body');
    if(!tabs||!body)return;
    tabs.setAttribute('aria-label','Report categories');body.setAttribute('role','tabpanel');
    const buttons=[...tabs.querySelectorAll(':scope > [data-tab]')];
    const sync=()=>buttons.forEach((button,index)=>{button.id=button.id||tabs.id+'-tab-'+index;button.setAttribute('aria-controls',body.id);button.tabIndex=button.classList.contains('active')?0:-1;if(button.tabIndex===0)body.setAttribute('aria-labelledby',button.id);});
    buttons.forEach((button,index)=>{
      button.addEventListener('click',sync);
      button.addEventListener('keydown',event=>{const next=event.key==='ArrowRight'?(index+1)%buttons.length:event.key==='ArrowLeft'?(index+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;if(next===null)return;event.preventDefault();buttons[next].click();buttons[next].focus();buttons[next].scrollIntoView({block:'nearest',inline:'nearest'});});
    });sync();
  },
  tabs:[['trips','Trip Reports'],['trucks','Truck Utilization'],['incidents','Incident Reports']],
  chart:null,
  render(ctx) {
    ctx.el.removeAttribute('aria-busy');
    ctx.setTitle('Reports','View trip activities, truck usage, and incident records.');
    const report=ctx.data.operationsReport;
    if(!report){ctx.el.innerHTML='<p class="alert alert-warning" role="alert">Report data is unavailable. Reload this page to try again.</p>';return;}
    const f=report.filters,custom=f.date_range==='custom',error=(message)=>{const el=ctx.el.querySelector('[data-report-error]');el.textContent=message;el.hidden=!message;};
    const query=(changes={})=>({...f,...changes});
    const load=changes=>{ctx.el.setAttribute('aria-busy','true');ctx.el.querySelector('[data-report-loading]').hidden=false;App.go('reports',query(changes));};
    ctx.el.innerHTML=`<div class="oh-reports"><nav class="oh-report-tabs" aria-label="Report types"><div role="tablist">${this.tabs.map(([key,label])=>`<a role="tab" aria-selected="${key===f.report}" ${key===f.report?'aria-current="page" class="active"':''} href="${OpsHead.link('reports',query({report:key}))}">${label}</a>`).join('')}</div></nav>
      <section class="oh-panel oh-report-filters" aria-label="Report Filters"><div class="oh-panel-head"><h2>Report Filters</h2></div><div class="oh-panel-body"><form data-report-filters novalidate>${UI.fields([
        {name:'date_range',label:'Date Range',type:'select',col:4,placeholder:false,value:f.date_range,options:[['today','Today'],['week','This Week'],['month','This Month'],['custom','Custom Range']]},
        {name:'truck_type',label:'Truck Type',type:'select',col:4,placeholder:'All Truck Types',value:f.truck_type,options:UI.list(['Container','Wing Van','Car Carrier'])},
      ])}<div class="oh-report-custom" data-custom-range ${custom?'':'hidden'}>${UI.fields([{name:'from',label:'Start Date',type:'date',required:true,col:6,value:f.from},{name:'to',label:'End Date',type:'date',required:true,col:6,value:f.to}])}</div><button class="btn btn-primary" type="submit">Apply Filters</button></form><p class="small text-muted mb-0 mt-2">${UI.esc(f.from)} – ${UI.esc(f.to)} · PHT</p><p class="text-danger small mb-0 mt-2" role="alert" data-report-error hidden></p></div></section>
      <div data-report-loading class="small text-muted mb-3" role="status" hidden><span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading report…</div>
      <section class="oh-report-cards" aria-label="${UI.esc(report.title)} summary">${report.cards.map(c=>`<article><span>${UI.esc(c.label)}</span><strong>${UI.num(c.value)}</strong></article>`).join('')}</section>
      <section class="oh-panel oh-report-chart" aria-labelledby="oh-report-chart-title"><div class="oh-panel-head"><h2 id="oh-report-chart-title">${UI.esc(report.chart.title)}</h2></div><div class="oh-panel-body"><div class="oh-report-chart-box"><canvas role="img" aria-label="${UI.esc(report.chart.labels.map((l,i)=>l+': '+report.chart.values[i]).join('; '))}" data-report-chart></canvas></div><p class="small text-muted mb-0 mt-2">${UI.esc(report.note)}</p></div></section>
      <section class="oh-panel oh-report-records" aria-label="Detailed Report Records"><div class="oh-panel-head"><h2>Detailed Report Records</h2><button class="btn btn-primary btn-sm" type="button" data-report-export><i class="bi bi-download" aria-hidden="true"></i> Export Report</button></div><div class="oh-panel-body"><form class="oh-report-search" role="search"><label class="visually-hidden" for="ohReportSearch">Search report records</label><input class="form-control" type="search" id="ohReportSearch" name="search" maxlength="200" value="${UI.esc(f.search)}" placeholder="Search report records…"><button class="btn btn-primary" type="submit">Search</button></form><p class="small" role="alert" data-export-error hidden></p><p class="small text-muted" data-report-count>${UI.num(report.total)} record(s)</p><div data-report-table></div><div class="oh-report-pagination"><span>Showing ${report.total?(report.page-1)*10+1:0}${report.total?'–'+Math.min(report.page*10,report.total):''} of ${report.total} records</span><nav aria-label="Report pages"><button class="btn btn-sm btn-outline-secondary" type="button" data-report-prev ${report.page<=1?'disabled':''}>Previous</button><span>Page ${report.page} of ${report.pages}</span><button class="btn btn-sm btn-outline-secondary" type="button" data-report-next ${report.page>=report.pages?'disabled':''}>Next</button></nav></div></div></section></div>`;
    const form=ctx.el.querySelector('[data-report-filters]');
    const apply=()=>{
      const d=UI.formData(form);error('');
      if(d.date_range==='custom'){
        const invalid=[form.elements.from,form.elements.to].find(el=>!el.value||!el.checkValidity());
        if(invalid){error('Choose valid Start Date and End Date values.');invalid.focus();return;}
        if(d.from>d.to){error('Start Date must be on or before End Date.');form.elements.to.focus();return;}
      }
      load({date_range:d.date_range,truck_type:d.truck_type,...(d.date_range==='custom'?{from:d.from,to:d.to}:{} )});
    };
    form.onsubmit=event=>{event.preventDefault();apply();};
    form.onchange=()=>{const isCustom=form.elements.date_range.value==='custom';ctx.el.querySelector('[data-custom-range]').hidden=!isCustom;apply();};
    ctx.el.querySelector('.oh-report-search').onsubmit=event=>{event.preventDefault();load({search:ctx.el.querySelector('#ohReportSearch').value.trim()});};
    ctx.el.querySelectorAll('[role=tab]').forEach((tab,index)=>{tab.onclick=event=>{event.preventDefault();load({report:this.tabs[index][0]});};tab.onkeydown=event=>{const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:null;if(next===null)return;event.preventDefault();ctx.el.querySelectorAll('[role=tab]')[next].focus();};});
    ctx.el.querySelector('[data-report-prev]').onclick=()=>load({report_page:report.page-1});ctx.el.querySelector('[data-report-next]').onclick=()=>load({report_page:report.page+1});
    const table=ctx.el.querySelector('[data-report-table]');
    const columns=report.columns.map(([label,key,format])=>[label,key,format==='datetime'?v=>OpsHead.datetime(v):format==='count'?v=>UI.num(v):format]);
    table.innerHTML=UI.table(columns,report.rows,{plain:true,limit:10,showAllColumns:true,actions:()=>UI.btn('view','View Details'),onAction:async(a,row)=>{
      try{
        if(f.report==='trips')await TripUI.open(row.id);
        else if(f.report==='trucks')await FleetUI.truckDetails(row.id,{can:{edit:false,status:false}});
        else {const r=await App.api('Analytics.operations_incident',{id:row.id});OpsHead.incident(r.incident);}
      }catch(ex){error(ex.message||'Could not open this record. Retry View Details.');}
    },empty:'No records found for the selected filters.'});UI.activate(table);
    const actionHeading=table.querySelector('th.actions-col .visually-hidden');if(actionHeading){actionHeading.classList.remove('visually-hidden');actionHeading.textContent='Action';}
    ctx.el.querySelector('[data-report-export]').onclick=async event=>{
      const button=event.currentTarget,message=ctx.el.querySelector('[data-export-error]');button.disabled=true;message.hidden=true;
      try{const result=await App.api('Analytics.operations_export',f);if(typeof result.csv!=='string'||!result.filename?.endsWith('.csv'))throw new Error('The report file could not be prepared. Retry Export Report.');this.download(result);}
      catch(ex){message.textContent=ex.message||'Export failed. Retry Export Report or reload this page.';message.hidden=false;}
      finally{button.disabled=false;}
    };
    this.drawChart(ctx.el.querySelector('[data-report-chart]'),report.chart);
  },
  drawChart(canvas,chart) {
    this.chart?.destroy();this.chart=null;
    if(typeof Chart==='undefined'){
      const fallback=document.createElement('p');fallback.className='small';fallback.textContent=chart.labels.map((l,i)=>l+': '+chart.values[i]).join(' · ');canvas.parentElement.replaceChildren(fallback);return;
    }
    const config=UI.chartConfig({type:'bar',horizontal:true,labels:chart.labels,datasets:[{label:'Records',data:chart.values}]},true);
    config.options.responsive=true;config.options.animation=false;
    config.data.datasets[0].backgroundColor='#247546';config.data.datasets[0].borderColor='#247546';
    this.chart=new Chart(canvas,config);
  },
  download(result) {
    const url=URL.createObjectURL(new Blob([result.csv],{type:result.mime||'text/csv;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download=result.filename;document.body.append(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  },
};
(()=>{const render=App.pages.reports.render;App.pages.reports.render=function(ctx){
  if(OpsHead.is()&&ctx.data.sections)return OpsReportsUI.analytics(ctx,render);
  ctx.el.classList.remove('oh-analytics');ctx.tools?.closest('.page-head')?.classList.remove('oh-analytics-head');
  return OpsHead.is()?OpsReportsUI.render(ctx):render.call(this,ctx);
};})();
