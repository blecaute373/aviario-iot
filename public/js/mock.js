    const mockState={nh3:15.2,umidade:18.5,temperatura:24.3,bateria:3.85,rssi:-65,pacotesRecebidos:1247,tempoUltimaLeitura:12,nosAtivos:[1,2,3],limites:{nh3:20,umidade:22,temperatura:26},atuadores:{ventilador:{ligado:false,manual:false},aspersor:{ligado:false,manual:false},exaustor:{ligado:false,manual:false},cortina:{ligado:false,manual:false}},baseTime:Date.now(),updateCount:0};
    function variar(v,min,max,d){const delta=(Math.random()-0.5)*d;return Math.round(Math.max(min,Math.min(max,v+delta))*10)/10;}
    function atualizarMockState(){
        mockState.updateCount++;mockState.tempoUltimaLeitura=Math.floor(Math.random()*60);
        mockState.pacotesRecebidos+=Math.floor(Math.random()*3)+1;mockState.rssi=Math.floor(-50-Math.random()*40);
        mockState.bateria=variar(mockState.bateria,3.3,4.2,0.02);
        const hora=new Date().getHours(),fd=1+Math.sin((hora-6)*Math.PI/12)*0.2;
        mockState.nh3=variar(mockState.nh3*fd,5,35,2);mockState.umidade=variar(mockState.umidade,10,40,1.5);mockState.temperatura=variar(mockState.temperatura*fd,18,32,0.8);
        const critico=mockState.nh3>mockState.limites.nh3||mockState.umidade>mockState.limites.umidade||mockState.temperatura>mockState.limites.temperatura;
        const ok=mockState.nh3<(mockState.limites.nh3-2)&&mockState.umidade<(mockState.limites.umidade-2)&&mockState.temperatura<(mockState.limites.temperatura-1);
        Object.keys(mockState.atuadores).forEach(t=>{const a=mockState.atuadores[t];if(a.manual)return;if(a.ligado&&ok)a.ligado=false;if(!a.ligado&&critico)a.ligado=true;});
    }
    function mockFetchStatus(){return new Promise(r=>{setTimeout(()=>{atualizarMockState();r({ok:true,json:()=>Promise.resolve({...mockState})});},100+Math.random()*200);});}
    function mockFetchHistorico(periodo){return new Promise(r=>{setTimeout(()=>{const agora=Date.now();let n,iv;switch(periodo){case'1h':n=60;iv=60000;break;case'6h':n=72;iv=300000;break;case'24h':n=96;iv=900000;break;default:n=168;iv=3600000;}let nb=12,ub=16,tb=22;const pts=[];for(let i=0;i<n;i++){const t=agora-(n-i)*iv,h=new Date(t).getHours(),fd=1+Math.sin((h-6)*Math.PI/12)*0.3;nb=variar(nb*fd,5,30,3);ub=variar(ub,12,35,2);tb=variar(tb*fd,20,30,1);pts.push({t,nh3:nb,umid:ub,temp:tb});}pts.push({t:agora,nh3:mockState.nh3,umid:mockState.umidade,temp:mockState.temperatura});r({ok:true,json:()=>Promise.resolve({dados:pts})});},150+Math.random()*300);});}
    function mockFetchAtuador(tipo,acao){return new Promise(r=>{setTimeout(()=>{const a=mockState.atuadores[tipo];if(a){if(acao==='on'){a.manual=true;a.ligado=true;}if(acao==='off'){a.manual=true;a.ligado=false;}if(acao==='auto')a.manual=false;}r({ok:true});},100);});}

