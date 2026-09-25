    // ---------- Zoom com dois dedos (pinch) no dashboard inteiro, sem botões ----------
    (function(){
        const wrapper = document.getElementById('zoomWrapper');
        const content = document.getElementById('zoomContent');
        if(!wrapper || !content) return;

        const MIN_SCALE = 0.7;
        const MAX_SCALE = 2.5;
        let scale = 1, tx = 0, ty = 0;
        let mode = null; // 'pinch' | 'pan'
        let startDist = 0, startScale = 1;
        let startMidX = 0, startMidY = 0;
        let startTx = 0, startTy = 0;
        let panStartX = 0, panStartY = 0;
        let lastTapTime = 0;

        function applyTransform(snap){
            content.classList.toggle('zoom-snap', !!snap);
            content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            wrapper.style.touchAction = scale > 1.02 ? 'none' : 'pan-y';
        }

        function distance(t1, t2){
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.sqrt(dx*dx + dy*dy);
        }
        function midpoint(t1, t2){
            return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
        }
        function clamp(v, min, max){ return Math.min(max, Math.max(min, v)); }

        function resetZoom(){
            scale = 1; tx = 0; ty = 0;
            applyTransform(true);
        }

        wrapper.addEventListener('touchstart', function(e){
            if(e.touches.length === 2){
                mode = 'pinch';
                startDist = distance(e.touches[0], e.touches[1]);
                startScale = scale;
                const mid = midpoint(e.touches[0], e.touches[1]);
                const rect = wrapper.getBoundingClientRect();
                startMidX = mid.x - rect.left;
                startMidY = mid.y - rect.top;
                startTx = tx; startTy = ty;
            } else if(e.touches.length === 1 && scale > 1.02){
                mode = 'pan';
                panStartX = e.touches[0].clientX - tx;
                panStartY = e.touches[0].clientY - ty;
            } else if(e.touches.length === 1){
                const now = Date.now();
                if(now - lastTapTime < 300){ resetZoom(); }
                lastTapTime = now;
            }
        }, { passive: true });

        wrapper.addEventListener('touchmove', function(e){
            if(mode === 'pinch' && e.touches.length === 2){
                e.preventDefault();
                const newDist = distance(e.touches[0], e.touches[1]);
                const newScale = clamp(startScale * (newDist / startDist), MIN_SCALE, MAX_SCALE);
                const scaleRatio = newScale / startScale;
                tx = startMidX - (startMidX - startTx) * scaleRatio;
                ty = startMidY - (startMidY - startTy) * scaleRatio;
                scale = newScale;
                applyTransform(false);
            } else if(mode === 'pan' && e.touches.length === 1){
                e.preventDefault();
                tx = e.touches[0].clientX - panStartX;
                ty = e.touches[0].clientY - panStartY;
                applyTransform(false);
            }
        }, { passive: false });

        function endTouch(e){
            if(e.touches.length < 2 && mode === 'pinch') mode = null;
            if(e.touches.length < 1 && mode === 'pan') mode = null;
            if(scale <= 1.03 && (tx !== 0 || ty !== 0 || scale !== 1)){
                resetZoom();
            }
        }
        wrapper.addEventListener('touchend', endTouch, { passive: true });
        wrapper.addEventListener('touchcancel', endTouch, { passive: true });
    })();

