    document.getElementById('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') handleLoginSubmit(); });
    if(sessionStorage.getItem('aerem_logged_in') === '1'){
        hideLoginScreen();
    } else {
        showLoginScreen();
    }
    const CONFIG={updateInterval:5000,limites:{nh3:20,umidade:22,temperatura:26}};
    let mainChart=null,currentPeriod='6h',limites=CONFIG.limites;

    function setMode(simulacao) {
        USE_MOCK = simulacao;
        const btnSim = document.getElementById('btnSimulacao');
        const btnReal = document.getElementById('btnReal');
        btnSim.className = 'mode-toggle-btn' + (simulacao ? ' active-sim' : '');
        btnReal.className = 'mode-toggle-btn' + (!simulacao ? ' active-real' : '');
        updateConnectionStatus(true);
        loadStatus();
        loadHistorico(currentPeriod);
    }

    document.addEventListener('DOMContentLoaded',()=>{
        initChart();loadStatus();loadHistorico(currentPeriod);
        document.querySelectorAll('.period-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentPeriod=btn.dataset.period;loadHistorico(currentPeriod);});});
        setInterval(()=>loadStatus(),CONFIG.updateInterval);
        setInterval(()=>loadHistorico(currentPeriod),CONFIG.updateInterval*3);
    });

    function initChart(){
        const ctx=document.getElementById('mainChart').getContext('2d');
        mainChart=new Chart(ctx,{type:'line',data:{datasets:[
            {label:'NH₃ (ppm)',borderColor:'#fbbf24',backgroundColor:'rgba(251,191,36,0.08)',borderWidth:2,fill:true,tension:0.4,pointRadius:0,pointHoverRadius:5,yAxisID:'y'},
            {label:'Umidade (%)',borderColor:'#38bdf8',backgroundColor:'rgba(56,189,248,0.08)',borderWidth:2,fill:true,tension:0.4,pointRadius:0,pointHoverRadius:5,yAxisID:'y'},
            {label:'Temperatura (°C)',borderColor:'#ff5252',backgroundColor:'rgba(255,82,82,0.08)',borderWidth:2,fill:true,tension:0.4,pointRadius:0,pointHoverRadius:5,yAxisID:'y1'}
        ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(10,13,20,0.95)',padding:12,borderColor:'#1e2535',borderWidth:1,callbacks:{title:ctx=>{if(ctx[0]?.parsed)return new Date(ctx[0].parsed.x).toLocaleString('pt-BR');return'';}}}} ,scales:{x:{type:'time',time:{displayFormats:{minute:'HH:mm',hour:'HH:mm',day:'dd/MM'}},grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#6b7280',maxTicksLimit:8}},y:{type:'linear',display:true,position:'left',title:{display:true,text:'ppm / %',color:'#6b7280'},min:0,max:50,grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#6b7280'}},y1:{type:'linear',display:true,position:'right',title:{display:true,text:'°C',color:'#6b7280'},min:10,max:40,grid:{drawOnChartArea:false},ticks:{color:'#6b7280'}}},animation:{duration:500}},plugins:[{beforeDraw:chart=>{const ctx=chart.ctx,yA=chart.scales.y,y1A=chart.scales.y1,xA=chart.scales.x;if(!yA||!y1A||!xA)return;ctx.save();ctx.setLineDash([5,5]);ctx.lineWidth=1;ctx.strokeStyle='rgba(255,255,255,0.2)';[limites.nh3,limites.umidade].forEach(v=>{const y=yA.getPixelForValue(v);ctx.beginPath();ctx.moveTo(xA.left,y);ctx.lineTo(xA.right,y);ctx.stroke();});const yt=y1A.getPixelForValue(limites.temperatura);ctx.beginPath();ctx.moveTo(xA.left,yt);ctx.lineTo(xA.right,yt);ctx.stroke();ctx.restore();}}]});
    }

    async function loadStatus(){
        try{
            const r=USE_MOCK?await mockFetchStatus():await fetch(`http://${BROKER_IP}:${BROKER_PORT}/api/status`);
            if(!r.ok)throw new Error();const d=await r.json();
            if(d.limites)limites=d.limites;
            document.getElementById('nh3Value').textContent=d.nh3?.toFixed(1)||'--';
            document.getElementById('umidadeValue').textContent=d.umidade?.toFixed(1)||'--';
            document.getElementById('temperaturaValue').textContent=d.temperatura?.toFixed(1)||'--';
            updateProgress('nh3Progress',d.nh3,limites.nh3*1.5);updateProgress('umidadeProgress',d.umidade,50);updateProgress('temperaturaProgress',d.temperatura,40);
            if(d.atuadores){['ventilador','aspersor','exaustor','cortina'].forEach(t=>updateAtuadorUI(t,d.atuadores[t]));}
            document.getElementById('nosAtivos').textContent=d.nosAtivos?.length||0;
            document.getElementById('bateria').textContent=(d.bateria?.toFixed(2)||'--')+'V';
            document.getElementById('rssi').textContent=(d.rssi||'--')+' dBm';
            document.getElementById('pacotes').textContent=d.pacotesRecebidos||0;
            if(d.tempoUltimaLeitura>=0){const m=Math.floor(d.tempoUltimaLeitura/60),s=d.tempoUltimaLeitura%60;document.getElementById('ultimaLeitura').textContent=m>0?`${m}m ${s}s`:`${s}s`;}
            checkAlerts(d);updateConnectionStatus(true);
        }catch(e){updateConnectionStatus(false);}
    }

    function updateAtuadorUI(tipo,estado){
        if(!estado)return;
        const chip=document.getElementById(`${tipo}Indicator`),st=document.getElementById(`${tipo}Status`),mo=document.getElementById(`${tipo}Modo`),card=document.querySelector(`.atuador-card.${tipo}`);
        if(chip)chip.className='atuador-chip '+(estado.ligado?'chip-on':'chip-off');
        if(st)st.textContent=tipo==='cortina'?(estado.ligado?'Aberta':'Fechada'):(estado.ligado?'Ligado':'Desligado');
        if(card)card.classList.toggle('is-on',estado.ligado);
        if(mo)mo.textContent='Modo: '+(estado.manual?'Manual':'Automático');
        if(card){card.querySelectorAll('.btn').forEach(b=>b.classList.remove('active'));if(estado.manual){card.querySelector(estado.ligado?'.btn-on':'.btn-off')?.classList.add('active');}else{card.querySelector('.btn-auto')?.classList.add('active');}}
    }

    async function loadHistorico(periodo){
        const loading=document.getElementById('chartLoading');loading.classList.remove('hidden');
        try{
            const r=USE_MOCK?await mockFetchHistorico(periodo):await fetch(`http://${BROKER_IP}:${BROKER_PORT}/api/dados?periodo=${periodo}`);
            if(!r.ok)throw new Error();const d=await r.json();const agora=Date.now();
            const nh3D=[],umidD=[],tempD=[];
            if(d.dados)d.dados.forEach(p=>{nh3D.push({x:p.t,y:p.nh3});umidD.push({x:p.t,y:p.umid});tempD.push({x:p.t,y:p.temp});});
            mainChart.data.datasets[0].data=nh3D;mainChart.data.datasets[1].data=umidD;mainChart.data.datasets[2].data=tempD;
            mainChart.options.scales.x.min=agora-getPeriodMs(periodo);mainChart.options.scales.x.max=agora;mainChart.update('none');
        }catch(e){}finally{loading.classList.add('hidden');}
    }

    async function controlarAtuador(tipo,acao){
        try{const r=USE_MOCK?await mockFetchAtuador(tipo,acao):await fetch(`http://${BROKER_IP}:${BROKER_PORT}/api/atuador?tipo=${tipo}&acao=${acao}`);if(r.ok)loadStatus();}catch(e){}
    }

    function updateProgress(id,v,max){const el=document.getElementById(id);if(el&&typeof v==='number')el.style.width=Math.min((v/max)*100,100)+'%';}
    function updateConnectionStatus(ok){const b=document.getElementById('connectionStatus');b.className='status-badge '+(USE_MOCK?'simulation':(ok?'online':'offline'));b.querySelector('span:last-child').textContent=USE_MOCK?'Simulação':(ok?`Conectado (${BROKER_IP})`:'Desconectado');}
    function checkAlerts(d){const ban=document.getElementById('alertBanner'),txt=document.getElementById('alertText');const al=[];if(d.nh3>limites.nh3)al.push(`NH₃: ${d.nh3.toFixed(1)} ppm`);if(d.umidade>limites.umidade)al.push(`Umidade: ${d.umidade.toFixed(1)}%`);if(d.temperatura>limites.temperatura)al.push(`Temp: ${d.temperatura.toFixed(1)}°C`);if(al.length){txt.textContent='Parâmetros altos: '+al.join(' | ');ban.classList.add('show');}else ban.classList.remove('show');}
    function getPeriodMs(p){return{h:3600000,'6h':6*3600000,'24h':24*3600000,'7d':7*24*3600000}[p]||3600000;}
