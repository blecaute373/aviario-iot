    // ---------- Autenticação (tela de login) ----------
    let loginIsRegisterMode = false;
    function hasStoredCredentials(){ return !!localStorage.getItem('aerem_auth_user'); }
    function toggleLoginMode(){
        loginIsRegisterMode = !loginIsRegisterMode;
        renderLoginMode();
    }
    function renderLoginMode(){
        const title = document.getElementById('loginTitle');
        const hint = document.getElementById('loginHint');
        const btn = document.getElementById('loginBtn');
        const toggle = document.getElementById('loginToggle');
        const err = document.getElementById('loginError');
        err.textContent = '';
        if(loginIsRegisterMode){
            title.textContent = 'Criar acesso';
            hint.textContent = 'Defina um usuário e senha para proteger o painel.';
            btn.textContent = 'Criar e entrar';
            toggle.textContent = hasStoredCredentials() ? 'Voltar para o login' : '';
            toggle.style.display = hasStoredCredentials() ? 'block' : 'none';
        } else {
            title.textContent = 'AEREM PLS';
            hint.textContent = 'Entre com suas credenciais para continuar';
            btn.textContent = 'Entrar';
            toggle.textContent = 'Configurar usuário e senha';
            toggle.style.display = 'block';
        }
    }
    function showLoginScreen(){
        loginIsRegisterMode = !hasStoredCredentials();
        renderLoginMode();
        document.getElementById('loginScreen').classList.remove('hidden');
    }
    function hideLoginScreen(){
        document.getElementById('loginScreen').classList.add('hidden');
    }
    async function simpleHash(text){
        const enc = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
    async function handleLoginSubmit(){
        const user = document.getElementById('loginUser').value.trim();
        const pass = document.getElementById('loginPass').value;
        const errEl = document.getElementById('loginError');
        errEl.textContent = '';
        if(!user || !pass){
            errEl.textContent = 'Preencha usuário e senha.';
            return;
        }
        if(loginIsRegisterMode){
            if(pass.length < 4){
                errEl.textContent = 'A senha deve ter pelo menos 4 caracteres.';
                return;
            }
            const hash = await simpleHash(pass);
            localStorage.setItem('aerem_auth_user', user);
            localStorage.setItem('aerem_auth_pass', hash);
            sessionStorage.setItem('aerem_logged_in', '1');
            hideLoginScreen();
            return;
        }
        const storedUser = localStorage.getItem('aerem_auth_user');
        const storedHash = localStorage.getItem('aerem_auth_pass');
        const hash = await simpleHash(pass);
        if(user === storedUser && hash === storedHash){
            sessionStorage.setItem('aerem_logged_in', '1');
            hideLoginScreen();
        } else {
            errEl.textContent = 'Usuário ou senha incorretos.';
        }
    }
    function logout(){
        sessionStorage.removeItem('aerem_logged_in');
        document.getElementById('loginUser').value = '';
        document.getElementById('loginPass').value = '';
        showLoginScreen();
    }
