    const DEFAULT_BROKER_IP = '192.168.0.5';
    const DEFAULT_BROKER_PORT = '80';
    let BROKER_IP = localStorage.getItem('aerem_broker_ip') || DEFAULT_BROKER_IP;
    let BROKER_PORT = localStorage.getItem('aerem_broker_port') || DEFAULT_BROKER_PORT;
    let USE_MOCK = true;

    // ---------- Configurações de conexão (IP e porta editáveis) ----------
    function openSettings(){
        document.getElementById('brokerIpInput').value = BROKER_IP;
        document.getElementById('brokerPortInput').value = BROKER_PORT;
        document.getElementById('settingsError').textContent = '';
        document.getElementById('settingsModal').classList.add('active');
    }
    function closeSettings(){
        document.getElementById('settingsModal').classList.remove('active');
    }
    function saveSettings(){
        const ip = document.getElementById('brokerIpInput').value.trim();
        const port = document.getElementById('brokerPortInput').value.trim();
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+$/;
        if(!ip || !ipRegex.test(ip)){
            document.getElementById('settingsError').textContent = 'Informe um endereço IP ou host válido.';
            return;
        }
        if(port && !/^\d{1,5}$/.test(port)){
            document.getElementById('settingsError').textContent = 'Informe uma porta válida (apenas números).';
            return;
        }
        BROKER_IP = ip;
        BROKER_PORT = port || DEFAULT_BROKER_PORT;
        localStorage.setItem('aerem_broker_ip', BROKER_IP);
        localStorage.setItem('aerem_broker_port', BROKER_PORT);
        closeSettings();
        if(!USE_MOCK) loadStatus();
    }

