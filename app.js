(() => {
    const ALL_RESTAURANTS = Array.isArray(window.GOURMET_RESTAURANTS) ? window.GOURMET_RESTAURANTS : [];

    const DAYS_PT = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado'
    ];

    // Estado global do aplicativo
    const state = {
        mode: 'battle', // 'battle' | 'slot' | 'champion'
        previousMode: 'battle',
        filters: {
            city: 'Belo Horizonte',
            circuit: 'all',
            moment: 'any',
            cuisine: ''
        },
        filteredPool: [],

        // Estado da Copa do Jantar (Bracket)
        tournament: {
            size: 8,
            rounds: [], // Array de rodadas: [{ name, matches: [{ a, b, winner }] }]
            currentRoundIdx: 0,
            currentMatchIdx: 0,
            usedIds: new Set(),
            champion: null
        },

        // Estado da Roleta com Trava (Slot Machine)
        slot: {
            lockedCuisine: false,
            lockedNeighborhood: false,
            selectedCuisine: '',
            selectedNeighborhood: '',
            currentRestaurant: null,
            isSpinning: false
        }
    };

    let championMapInstance = null;
    let detailMapInstance = null;

    // Helper unificado para Umami Analytics e Plausible Analytics (100% cookieless)
    function trackGameEvent(eventName, props = {}) {
        try {
            if (window.umami && typeof window.umami.track === 'function') {
                window.umami.track(eventName, props);
            }
            if (typeof window.plausible === 'function') {
                window.plausible(eventName, { props });
            }
        } catch (err) {
            // Ignora silenciosamente caso bloqueadores estejam ativos
        }
    }

    // Utilitário de transição de tela com View Transitions API + roteamento de foco acessível
    function transitionToView(targetView, focusHeadingId) {
        const updateDOM = () => {
            document.getElementById('viewBattle').hidden = targetView !== 'battle';
            document.getElementById('viewSlot').hidden = targetView !== 'slot';
            document.getElementById('viewChampion').hidden = targetView !== 'champion';

            document.getElementById('tabBattle').classList.toggle('active', targetView === 'battle');
            document.getElementById('tabBattle').setAttribute('aria-pressed', String(targetView === 'battle'));
            document.getElementById('tabSlot').classList.toggle('active', targetView === 'slot');
            document.getElementById('tabSlot').setAttribute('aria-pressed', String(targetView === 'slot'));
        };

        if (!document.startViewTransition) {
            updateDOM();
            if (focusHeadingId) {
                document.getElementById(focusHeadingId)?.focus({ preventScroll: true });
            }
            return;
        }

        const transition = document.startViewTransition(() => {
            updateDOM();
        });

        transition.finished.finally(() => {
            if (focusHeadingId) {
                document.getElementById(focusHeadingId)?.focus({ preventScroll: true });
            }
        });
    }

    // Limpa avisos automáticos de IA das descrições
    function cleanDescription(desc) {
        if (!desc) return 'Experiência gastronômica selecionada na curadoria Gourmet Map.';
        return desc
            .replace(/\*?\(?Conteúdo gerado por IA\.?.*?consulte o restaurante\.?\)?/gi, '')
            .replace(/Cardápio está sujeito a alterações,?\s*consulte o restaurante\.?/gi, '')
            .trim();
    }

    // Extrai marca base para evitar repetição de franquias na mesma chave
    function getBaseBrand(name) {
        return (name || '').replace(/\(.*?\)/g, '').trim().toLowerCase();
    }

    // Verifica se um horário "HH:MM - HH:MM" cobre os minutos atuais
    function isTimeRangeOpenNow(rangeStr, nowMinutes) {
        if (!rangeStr || typeof rangeStr !== 'string') return false;
        const m = rangeStr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!m) return false;
        const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
        if (end < start) end += 24 * 60;
        return nowMinutes >= start && nowMinutes <= end;
    }

    // Verifica se o restaurante atende ao filtro de momento ("Quando")
    function matchesMomentFilter(restaurant, moment) {
        if (!moment || moment === 'any') return true;
        const sched = restaurant.schedule || {};
        const now = new Date();
        const todayName = DAYS_PT[now.getDay()];

        const getDayObj = (dayName) => sched[dayName] || sched[`${dayName} (Hoje)`] || null;

        if (moment === 'open_now') {
            const d = getDayObj(todayName);
            if (!d || typeof d !== 'object') return false;
            const nowMins = now.getHours() * 60 + now.getMinutes();
            return isTimeRangeOpenNow(d.almoco, nowMins) || isTimeRangeOpenNow(d.jantar, nowMins);
        }

        if (moment === 'today_any') {
            const d = getDayObj(todayName);
            return Boolean(d && (d.almoco || d.jantar));
        }
        if (moment === 'today_almoco') {
            const d = getDayObj(todayName);
            return Boolean(d && d.almoco);
        }
        if (moment === 'today_jantar') {
            const d = getDayObj(todayName);
            return Boolean(d && d.jantar);
        }
        if (moment === 'fri_jantar') {
            const d = getDayObj('Sexta-feira');
            return Boolean(d && d.jantar);
        }
        if (moment === 'sat_almoco') {
            const d = getDayObj('Sábado');
            return Boolean(d && d.almoco);
        }
        if (moment === 'sat_jantar') {
            const d = getDayObj('Sábado');
            return Boolean(d && d.jantar);
        }
        if (moment === 'sun_almoco') {
            const d = getDayObj('Domingo');
            return Boolean(d && d.almoco);
        }
        return true;
    }

    // Retorna texto resumido do horário relevante para exibir no card
    function getRelevantScheduleSummary(restaurant) {
        const sched = restaurant.schedule || {};
        const now = new Date();
        let targetDay = DAYS_PT[now.getDay()];

        if (state.filters.moment === 'fri_jantar') targetDay = 'Sexta-feira';
        else if (state.filters.moment === 'sat_almoco' || state.filters.moment === 'sat_jantar') targetDay = 'Sábado';
        else if (state.filters.moment === 'sun_almoco') targetDay = 'Domingo';

        const d = sched[targetDay] || sched[`${targetDay} (Hoje)`];
        if (d && (d.almoco || d.jantar)) {
            const parts = [];
            if (d.almoco) parts.push(`Almoço: ${d.almoco}`);
            if (d.jantar) parts.push(`Jantar: ${d.jantar}`);
            return `${targetDay}: ${parts.join(' • ')}`;
        }

        // Caso fechado no dia alvo, procurar próximo dia aberto
        for (const day of DAYS_PT) {
            const daySched = sched[day];
            if (daySched && (daySched.almoco || daySched.jantar)) {
                const parts = [];
                if (daySched.almoco) parts.push(`Almoço ${daySched.almoco}`);
                if (daySched.jantar) parts.push(`Jantar ${daySched.jantar}`);
                return `${day}: ${parts.join(' • ')}`;
            }
        }

        if (restaurant.is_restaurant_week && !restaurant.is_duo) {
            return 'Consulte horários do festival Restaurant Week';
        }
        return 'Consulte horários de funcionamento';
    }

    // Inicializa seletores de Cidade e Cozinha com base nos dados reais
    function populateContextDropdowns() {
        const citySelect = document.getElementById('filterCity');
        const cityCounts = new Map();
        ALL_RESTAURANTS.forEach(r => {
            cityCounts.set(r.city, (cityCounts.get(r.city) || 0) + 1);
        });

        const sortedCities = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]);
        citySelect.innerHTML = `<option value="">Todas as Cidades (${ALL_RESTAURANTS.length})</option>`;
        sortedCities.forEach(([city, count]) => {
            const selected = city === 'Belo Horizonte' ? 'selected' : '';
            citySelect.innerHTML += `<option value="${city}" ${selected}>${city} (${count})</option>`;
        });

        updateCuisineDropdown();
    }

    function updateCuisineDropdown() {
        const cuisineSelect = document.getElementById('filterCuisine');
        const currentCuisine = state.filters.cuisine;

        const basePool = ALL_RESTAURANTS.filter(r => {
            if (state.filters.city && r.city !== state.filters.city) return false;
            if (state.filters.circuit === 'duo' && !r.is_duo) return false;
            if (state.filters.circuit === 'rw' && !r.is_restaurant_week) return false;
            if (state.filters.circuit === 'both' && (!r.is_duo || !r.is_restaurant_week)) return false;
            if (!matchesMomentFilter(r, state.filters.moment)) return false;
            return true;
        });

        const cuisineCounts = new Map();
        basePool.forEach(r => {
            cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) || 0) + 1);
        });

        const sortedCuisines = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1]);
        cuisineSelect.innerHTML = `<option value="">Todas as Cozinhas (${basePool.length})</option>`;
        sortedCuisines.forEach(([cuisine, count]) => {
            const sel = cuisine === currentCuisine ? 'selected' : '';
            cuisineSelect.innerHTML += `<option value="${cuisine}" ${sel}>${cuisine} (${count})</option>`;
        });

        if (currentCuisine && !cuisineCounts.has(currentCuisine)) {
            state.filters.cuisine = '';
            cuisineSelect.value = '';
        }
    }

    // Aplica os filtros do topo e atualiza o pool ativo
    function applyFiltersAndRefresh(resetGame = true) {
        updateCuisineDropdown();

        state.filteredPool = ALL_RESTAURANTS.filter(r => {
            if (state.filters.city && r.city !== state.filters.city) return false;
            if (state.filters.circuit === 'duo' && !r.is_duo) return false;
            if (state.filters.circuit === 'rw' && !r.is_restaurant_week) return false;
            if (state.filters.circuit === 'both' && (!r.is_duo || !r.is_restaurant_week)) return false;
            if (!matchesMomentFilter(r, state.filters.moment)) return false;
            if (state.filters.cuisine && r.cuisine !== state.filters.cuisine) return false;
            return true;
        });

        const badge = document.getElementById('poolCountBadge');
        badge.innerHTML = `<i class="fa-solid fa-fire" aria-hidden="true"></i> <span>${state.filteredPool.length} restaurantes no páreo</span>`;

        if (resetGame) {
            initTournament(state.tournament.size);
            syncSlotMachineOptions();
            spinSlotMachine(false);
        }
    }

    // Embaralhamento Fisher-Yates
    function shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Seleciona N restaurantes priorizando marcas distintas
    function sampleDiverseRestaurants(pool, count, excludeIds = new Set()) {
        const candidates = shuffle(pool.filter(r => !excludeIds.has(r.id)));
        const chosen = [];
        const seenBrands = new Set();

        for (const r of candidates) {
            if (chosen.length >= count) break;
            const brand = getBaseBrand(r.name);
            if (!seenBrands.has(brand)) {
                seenBrands.add(brand);
                chosen.push(r);
            }
        }

        // Completar se o filtro for muito restrito e houver franquias
        if (chosen.length < count) {
            for (const r of candidates) {
                if (chosen.length >= count) break;
                if (!chosen.some(c => c.id === r.id)) {
                    chosen.push(r);
                }
            }
        }
        return chosen;
    }

    // ========================================================
    // MODO 1: COPA DO JANTAR (TORNEIO DE ELIMINAÇÃO)
    // ========================================================
    function getRoundLabel(matchCount) {
        if (matchCount === 8) return 'Oitavas de Final';
        if (matchCount === 4) return 'Quartas de Final';
        if (matchCount === 2) return 'Semifinal';
        if (matchCount === 1) return 'Grande Final 🏆';
        return 'Eliminatórias';
    }

    function initTournament(requestedSize = 8) {
        state.tournament.size = requestedSize;
        const poolSize = state.filteredPool.length;
        const container = document.getElementById('battleArenaContainer');

        if (poolSize < 2) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Poucos restaurantes para este filtro 😅</h3>
                    <p style="margin: 8px 0 16px; color: var(--text-muted);">Encontramos apenas ${poolSize} restaurante(s) com esses filtros combinados. Tente ampliar a cozinha ou o horário!</p>
                    <button type="button" class="btn-pick" style="max-width: 240px; margin: 0 auto;" id="resetFiltersEmptyBtn">
                        Limpar Filtros Restritos
                    </button>
                </div>
            `;
            document.getElementById('resetFiltersEmptyBtn')?.addEventListener('click', () => {
                state.filters.cuisine = '';
                state.filters.moment = 'any';
                state.filters.circuit = 'all';
                document.getElementById('filterCuisine').value = '';
                document.getElementById('filterMoment').value = 'any';
                document.getElementById('filterCircuit').value = 'all';
                applyFiltersAndRefresh(true);
            });
            return;
        }

        // Garantir estrutura da arena caso tenha vindo do empty state
        if (!document.getElementById('cardLeft')) {
            container.innerHTML = `
                <div class="battle-arena" id="battleArena">
                    <article class="contender-card" id="cardLeft"></article>
                    <div class="vs-divider">
                        <div class="vs-circle" aria-hidden="true">VS</div>
                        <button type="button" class="reroll-pair-btn" id="rerollPairBtn" title="Não curtiu nenhum dos dois? Trocar esta dupla">
                            <i class="fa-solid fa-shuffle" aria-hidden="true"></i>
                            Trocar dupla
                        </button>
                    </div>
                    <article class="contender-card" id="cardRight"></article>
                </div>
            `;
            document.getElementById('rerollPairBtn')?.addEventListener('click', rerollCurrentPair);
        }

        // Ajustar potência de 2 ao tamanho do pool disponível
        let effectiveSize = requestedSize;
        while (effectiveSize > poolSize && effectiveSize > 2) {
            effectiveSize = effectiveSize / 2;
        }

        const picked = sampleDiverseRestaurants(state.filteredPool, effectiveSize);
        state.tournament.usedIds = new Set(picked.map(r => r.id));
        state.tournament.currentRoundIdx = 0;
        state.tournament.currentMatchIdx = 0;
        state.tournament.champion = null;

        const firstRoundMatches = [];
        for (let i = 0; i < picked.length; i += 2) {
            firstRoundMatches.push({
                a: picked[i],
                b: picked[i + 1],
                winner: null
            });
        }

        state.tournament.rounds = [
            {
                name: getRoundLabel(firstRoundMatches.length),
                matches: firstRoundMatches
            }
        ];

        renderCurrentBattleMatch();
    }

    function renderContenderCardHTML(r, side) {
        const desc = cleanDescription(r.description);
        const schedText = getRelevantScheduleSummary(r);
        const keyHint = side === 'left' ? '1' : '2';

        let rwHighlight = '';
        if (r.is_restaurant_week && r.restaurant_week) {
            const rw = r.restaurant_week;
            const edition = rw.event_edition || 'Restaurant Week';
            rwHighlight = `
                <div class="rw-preview-box">
                    <strong><i class="fa-solid fa-wine-glass"></i> ${edition}</strong>
                    <span>Participante oficial do circuito gastronômico</span>
                </div>
            `;
        }

        const googleBadge = r.google_rating
            ? `<span class="metric-chip google-rating"><i class="fa-brands fa-google"></i> ${r.google_rating}${r.google_reviews_count ? ` (${r.google_reviews_count})` : ''}</span>`
            : '';

        const duoRatingBadge = r.rating && r.rating !== 'N/A' && r.rating !== 'RW'
            ? `<span class="metric-chip duo-rating"><i class="fa-solid fa-star"></i> ${r.rating} Duo</span>`
            : '';

        const priceBadge = r.google_price_level
            ? `<span class="metric-chip price-chip">${'$'.repeat(Number(r.google_price_level) || 2)}</span>`
            : '';

        const highlightsHTML = Array.isArray(r.highlights) && r.highlights.length > 0
            ? `<div class="card-highlights">${r.highlights.map(h => `<span class="highlight-pill"><i class="fa-solid fa-fire-flame-curved" aria-hidden="true"></i> ${h}</span>`).join('')}</div>`
            : '';

        return `
            <div>
                <div class="card-color-bar" style="background-color: ${r.color};"></div>
                <div class="card-body">
                    <div class="card-top-tags">
                        <span class="cuisine-tag" style="background-color: ${r.color};">
                            <i class="fa-solid fa-utensils" aria-hidden="true"></i> ${r.cuisine}
                        </span>
                        <div class="circuit-badges">
                            ${r.is_duo ? '<span class="badge-duo">Duo Gourmet</span>' : ''}
                            ${r.is_restaurant_week ? '<span class="badge-rw">Restaurant Week</span>' : ''}
                        </div>
                    </div>

                    <div class="card-title-group">
                        <h3>${r.name}</h3>
                        <p class="card-location">
                            <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                            ${r.neighborhood} • ${r.city}
                        </p>
                    </div>

                    <div class="card-metrics">
                        ${duoRatingBadge}
                        ${googleBadge}
                        ${priceBadge}
                    </div>

                    ${highlightsHTML}

                    <p class="card-description">${desc}</p>
                    ${rwHighlight}

                    <div class="card-schedule-pill">
                        <i class="fa-regular fa-clock" aria-hidden="true"></i>
                        <span>${schedText}</span>
                    </div>
                </div>
            </div>

            <div class="card-footer">
                <button type="button" class="btn-pick" data-pick-side="${side}">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    Escolher este!
                    <kbd title="Atalho de teclado">${keyHint}</kbd>
                </button>
                <button type="button" class="btn-details" data-detail-id="${r.id}" aria-label="Ver detalhes e mapa de ${r.name}">
                    <i class="fa-solid fa-map-pin" aria-hidden="true"></i>
                    Mapa / Info
                </button>
            </div>
        `;
    }

    function renderBracketProgressBar() {
        const totalMatches = state.tournament.size - 1;
        let completedMatches = 0;
        for (let r = 0; r < state.tournament.rounds.length; r++) {
            for (const m of state.tournament.rounds[r].matches) {
                if (m.winner) completedMatches++;
            }
        }

        const progressEl = document.getElementById('bracketProgress');
        let html = '';
        for (let i = 0; i < totalMatches; i++) {
            let cls = 'progress-step';
            if (i < completedMatches) cls += ' done';
            else if (i === completedMatches) cls += ' current';
            html += `<div class="${cls}"></div>`;
        }
        progressEl.innerHTML = html;
    }

    function renderCurrentBattleMatch() {
        const round = state.tournament.rounds[state.tournament.currentRoundIdx];
        if (!round) return;
        const match = round.matches[state.tournament.currentMatchIdx];
        if (!match) return;

        document.getElementById('roundBadge').textContent = round.name;
        document.getElementById('matchCounterText').textContent =
            `Duelo ${state.tournament.currentMatchIdx + 1} de ${round.matches.length} • Quem avança para a próxima fase?`;

        renderBracketProgressBar();

        const leftEl = document.getElementById('cardLeft');
        const rightEl = document.getElementById('cardRight');

        leftEl.innerHTML = renderContenderCardHTML(match.a, 'left');
        rightEl.innerHTML = renderContenderCardHTML(match.b, 'right');

        // Somente mostrar "Trocar dupla" na 1ª rodada (antes de alguém já ter vencido)
        const rerollBtn = document.getElementById('rerollPairBtn');
        if (rerollBtn) {
            rerollBtn.hidden = state.tournament.currentRoundIdx > 0;
        }
    }

    function pickBattleWinner(side) {
        const round = state.tournament.rounds[state.tournament.currentRoundIdx];
        if (!round) return;
        const match = round.matches[state.tournament.currentMatchIdx];
        if (!match) return;

        const chosen = side === 'left' ? match.a : match.b;
        match.winner = chosen;

        // Verificar se ainda há confrontos nesta rodada
        if (state.tournament.currentMatchIdx + 1 < round.matches.length) {
            state.tournament.currentMatchIdx++;
            if (document.startViewTransition) {
                const t = document.startViewTransition(() => renderCurrentBattleMatch());
                t.finished.finally(() => {
                    document.getElementById('battle-heading')?.focus({ preventScroll: true });
                });
            } else {
                renderCurrentBattleMatch();
                document.getElementById('battle-heading')?.focus({ preventScroll: true });
            }
            return;
        }

        // Fim da rodada: verificar se era a Grande Final
        if (round.matches.length === 1) {
            state.tournament.champion = chosen;
            showChampionScreen(chosen, 'Campeão da Copa do Jantar 🏆');
            return;
        }

        // Montar próxima rodada com os vencedores
        const winners = round.matches.map(m => m.winner);
        const nextMatches = [];
        for (let i = 0; i < winners.length; i += 2) {
            nextMatches.push({
                a: winners[i],
                b: winners[i + 1],
                winner: null
            });
        }

        state.tournament.rounds.push({
            name: getRoundLabel(nextMatches.length),
            matches: nextMatches
        });
        state.tournament.currentRoundIdx++;
        state.tournament.currentMatchIdx = 0;

        showToast(`🔥 Começando a ${getRoundLabel(nextMatches.length)}!`);

        if (document.startViewTransition) {
            const t = document.startViewTransition(() => renderCurrentBattleMatch());
            t.finished.finally(() => {
                document.getElementById('battle-heading')?.focus({ preventScroll: true });
            });
        } else {
            renderCurrentBattleMatch();
            document.getElementById('battle-heading')?.focus({ preventScroll: true });
        }
    }

    function rerollCurrentPair() {
        if (state.tournament.currentRoundIdx > 0) return;
        const round = state.tournament.rounds[0];
        const match = round?.matches[state.tournament.currentMatchIdx];
        if (!match) return;

        const replacements = sampleDiverseRestaurants(state.filteredPool, 2, state.tournament.usedIds);
        if (replacements.length < 2) {
            showToast('Não há mais restaurantes inéditos neste filtro para trocar!');
            return;
        }

        replacements.forEach(r => state.tournament.usedIds.add(r.id));
        match.a = replacements[0];
        match.b = replacements[1];

        if (document.startViewTransition) {
            document.startViewTransition(() => renderCurrentBattleMatch());
        } else {
            renderCurrentBattleMatch();
        }
    }

    // ========================================================
    // MODO 2: ROLETA GOURMET COM TRAVA 🔒 (SLOT MACHINE)
    // ========================================================
    function getSlotCompatiblePool() {
        return state.filteredPool.filter(r => {
            if (state.slot.lockedCuisine && state.slot.selectedCuisine && r.cuisine !== state.slot.selectedCuisine) {
                return false;
            }
            if (state.slot.lockedNeighborhood && state.slot.selectedNeighborhood && r.neighborhood !== state.slot.selectedNeighborhood) {
                return false;
            }
            return true;
        });
    }

    function syncSlotMachineOptions() {
        const cuisineSelect = document.getElementById('manualCuisineSelect');
        const neighSelect = document.getElementById('manualNeighborhoodSelect');

        // Culinárias compatíveis (se bairro estiver travado, filtra pelo bairro)
        const poolForCuisines = state.filteredPool.filter(r =>
            !state.slot.lockedNeighborhood || !state.slot.selectedNeighborhood || r.neighborhood === state.slot.selectedNeighborhood
        );
        const cuisines = [...new Set(poolForCuisines.map(r => r.cuisine))].sort();

        cuisineSelect.innerHTML = '<option value="">🎲 Sortear qualquer culinária</option>';
        cuisines.forEach(c => {
            const sel = state.slot.selectedCuisine === c && state.slot.lockedCuisine ? 'selected' : '';
            cuisineSelect.innerHTML += `<option value="${c}" ${sel}>🔒 ${c}</option>`;
        });

        // Bairros compatíveis (se culinária estiver travada, filtra pela culinária)
        const poolForNeighborhoods = state.filteredPool.filter(r =>
            !state.slot.lockedCuisine || !state.slot.selectedCuisine || r.cuisine === state.slot.selectedCuisine
        );
        const neighborhoods = [...new Set(poolForNeighborhoods.map(r => r.neighborhood))].sort();

        neighSelect.innerHTML = '<option value="">🎲 Sortear qualquer bairro</option>';
        neighborhoods.forEach(n => {
            const sel = state.slot.selectedNeighborhood === n && state.slot.lockedNeighborhood ? 'selected' : '';
            neighSelect.innerHTML += `<option value="${n}" ${sel}>🔒 ${n}</option>`;
        });

        updateSlotLockUI();
    }

    function updateSlotLockUI() {
        const boxCuisine = document.getElementById('reelBoxCuisine');
        const btnCuisine = document.getElementById('lockCuisineBtn');
        boxCuisine.classList.toggle('locked', state.slot.lockedCuisine);
        btnCuisine.setAttribute('aria-pressed', String(state.slot.lockedCuisine));
        btnCuisine.innerHTML = state.slot.lockedCuisine
            ? '<i class="fa-solid fa-lock" aria-hidden="true"></i><span>Travado</span>'
            : '<i class="fa-solid fa-lock-open" aria-hidden="true"></i><span>Travar</span>';

        const boxNeigh = document.getElementById('reelBoxNeighborhood');
        const btnNeigh = document.getElementById('lockNeighborhoodBtn');
        boxNeigh.classList.toggle('locked', state.slot.lockedNeighborhood);
        btnNeigh.setAttribute('aria-pressed', String(state.slot.lockedNeighborhood));
        btnNeigh.innerHTML = state.slot.lockedNeighborhood
            ? '<i class="fa-solid fa-lock" aria-hidden="true"></i><span>Travado</span>'
            : '<i class="fa-solid fa-lock-open" aria-hidden="true"></i><span>Travar</span>';

        const subPool = getSlotCompatiblePool();
        document.getElementById('slotPoolSubCount').textContent = `${subPool.length} opções`;
    }

    function spinSlotMachine(animate = true) {
        if (state.slot.isSpinning) return;
        const compatiblePool = getSlotCompatiblePool();

        const valCuisine = document.getElementById('reelValueCuisine');
        const valNeigh = document.getElementById('reelValueNeighborhood');
        const valRest = document.getElementById('reelValueRestaurant');
        const resultContainer = document.getElementById('slotResultCardContainer');

        if (compatiblePool.length === 0) {
            valCuisine.textContent = state.slot.selectedCuisine || '—';
            valNeigh.textContent = state.slot.selectedNeighborhood || '—';
            valRest.textContent = 'Nenhuma opção combinada';
            resultContainer.innerHTML = `
                <div class="empty-state">
                    <h3>Nenhuma combinação para essa trava 🔒</h3>
                    <p style="margin-top: 6px; color: var(--text-muted);">Destrave a culinária ou o bairro para girar novamente.</p>
                </div>
            `;
            return;
        }

        // Evitar repetir exatamente o mesmo restaurante se houver mais de 1 opção
        let candidates = compatiblePool;
        if (compatiblePool.length > 1 && state.slot.currentRestaurant) {
            candidates = compatiblePool.filter(r => r.id !== state.slot.currentRestaurant.id);
        }
        const winner = candidates[Math.floor(Math.random() * candidates.length)];

        const finalizeSpin = () => {
            state.slot.currentRestaurant = winner;
            state.slot.selectedCuisine = winner.cuisine;
            state.slot.selectedNeighborhood = winner.neighborhood;

            valCuisine.textContent = winner.cuisine;
            valNeigh.textContent = winner.neighborhood;
            valRest.textContent = winner.name;

            syncSlotMachineOptions();
            renderSlotSpotlightCard(winner);
        };

        if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            finalizeSpin();
            return;
        }

        state.slot.isSpinning = true;
        const winCuisine = document.getElementById('reelWindowCuisine');
        const winNeigh = document.getElementById('reelWindowNeighborhood');
        const winRest = document.getElementById('reelWindowRestaurant');

        if (!state.slot.lockedCuisine) winCuisine.classList.add('spinning');
        if (!state.slot.lockedNeighborhood) winNeigh.classList.add('spinning');
        winRest.classList.add('spinning');

        let ticks = 0;
        const interval = setInterval(() => {
            const sample = compatiblePool[Math.floor(Math.random() * compatiblePool.length)];
            if (!state.slot.lockedCuisine) valCuisine.textContent = sample.cuisine;
            if (!state.slot.lockedNeighborhood) valNeigh.textContent = sample.neighborhood;
            valRest.textContent = sample.name;
            ticks++;

            if (ticks >= 9) {
                clearInterval(interval);
                winCuisine.classList.remove('spinning');
                winNeigh.classList.remove('spinning');
                winRest.classList.remove('spinning');
                state.slot.isSpinning = false;
                finalizeSpin();
            }
        }, 55);
    }

    function renderSlotSpotlightCard(r) {
        const container = document.getElementById('slotResultCardContainer');
        if (!r) {
            container.innerHTML = '';
            return;
        }
        const desc = cleanDescription(r.description);
        const schedText = getRelevantScheduleSummary(r);

        container.innerHTML = `
            <article class="contender-card" style="max-width: 780px; margin: 0 auto;">
                <div class="card-color-bar" style="background-color: ${r.color};"></div>
                <div class="card-body">
                    <div class="card-top-tags">
                        <span class="cuisine-tag" style="background-color: ${r.color};">
                            <i class="fa-solid fa-utensils" aria-hidden="true"></i> ${r.cuisine}
                        </span>
                        <div class="circuit-badges">
                            ${r.is_duo ? '<span class="badge-duo">Duo Gourmet</span>' : ''}
                            ${r.is_restaurant_week ? '<span class="badge-rw">Restaurant Week</span>' : ''}
                        </div>
                    </div>
                    <div class="card-title-group">
                        <h3>${r.name}</h3>
                        <p class="card-location">
                            <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                            ${r.address || `${r.neighborhood} • ${r.city}`}
                        </p>
                    </div>
                    <p class="card-description">${desc}</p>
                    <div class="card-schedule-pill">
                        <i class="fa-regular fa-clock" aria-hidden="true"></i>
                        <span>${schedText}</span>
                    </div>
                </div>
                <div class="card-footer">
                    <button type="button" class="btn-pick" id="slotCardConfirmBtn">
                        <i class="fa-solid fa-champagne-glasses" aria-hidden="true"></i>
                        Fechou! Vamos nesse hoje
                    </button>
                    <button type="button" class="btn-details" data-detail-id="${r.id}">
                        <i class="fa-solid fa-map-pin" aria-hidden="true"></i>
                        Ver no Mapa / Horários
                    </button>
                </div>
            </article>
        `;

        document.getElementById('slotCardConfirmBtn')?.addEventListener('click', () => {
            showChampionScreen(r, 'Sorteado na Roleta Gourmet 🎰');
        });
    }

    // ========================================================
    // TELA DO CAMPEÃO DE HOJE 🏆 + MAPA INTERATIVO LEAFLET
    // ========================================================
    function buildScheduleTableHTML(schedule) {
        const todayName = DAYS_PT[new Date().getDay()];
        let rows = '';
        for (const day of DAYS_PT) {
            const d = (schedule && (schedule[day] || schedule[`${day} (Hoje)`])) || null;
            const isToday = day === todayName;
            const almoco = d && d.almoco ? d.almoco : '—';
            const jantar = d && d.jantar ? d.jantar : '—';
            rows += `
                <tr class="${isToday ? 'today-row' : ''}">
                    <td>${day}${isToday ? ' (Hoje)' : ''}</td>
                    <td>${almoco}</td>
                    <td>${jantar}</td>
                </tr>
            `;
        }
        return `
            <table class="schedule-table">
                <thead>
                    <tr>
                        <th>Dia</th>
                        <th>Almoço / Tarde</th>
                        <th>Jantar / Noite</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    // Distância Haversine em km entre duas coordenadas
    function haversineKm(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 99;
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Motor de Recomendação por Afinidade ("Plano B Inteligente" inspirado em Surprise - Cat. 12)
    function computeAffinityRecommendations(champion) {
        const cuisineVotes = new Map();
        const neighVotes = new Map();

        state.tournament.rounds.forEach(rd => {
            rd.matches.forEach(m => {
                if (m.winner) {
                    cuisineVotes.set(m.winner.cuisine, (cuisineVotes.get(m.winner.cuisine) || 0) + 1);
                    neighVotes.set(m.winner.neighborhood, (neighVotes.get(m.winner.neighborhood) || 0) + 1);
                }
            });
        });

        const champBrand = getBaseBrand(champion.name);
        const candidates = state.filteredPool.filter(
            r => r.id !== champion.id && getBaseBrand(r.name) !== champBrand
        );

        const scored = candidates.map(r => {
            let score = 50;
            if (r.cuisine === champion.cuisine) score += 26;
            else if (cuisineVotes.has(r.cuisine)) score += 14 * cuisineVotes.get(r.cuisine);

            if (r.neighborhood === champion.neighborhood) score += 15;
            else if (neighVotes.has(r.neighborhood)) score += 8 * neighVotes.get(r.neighborhood);

            const dist = haversineKm(champion.lat, champion.lon, r.lat, r.lon);
            if (dist <= 1.5) score += 10;
            else if (dist <= 3.5) score += 5;

            const ratingNum = parseFloat(String(r.rating).replace(',', '.')) || 4.5;
            score += (ratingNum - 4.5) * 8;

            const matchPct = Math.min(99, Math.max(72, Math.round(score)));
            return { restaurant: r, matchPct, dist };
        });

        scored.sort((a, b) => b.matchPct - a.matchPct || a.dist - b.dist);
        return scored.slice(0, 3);
    }

    function showChampionScreen(r, badgeLabel = 'Seu Restaurante de Hoje! 🏆') {
        state.previousMode = state.mode === 'champion' ? state.previousMode : state.mode;
        state.mode = 'champion';

        trackGameEvent('champion_selected', {
            restaurant: r.name,
            cuisine: r.cuisine,
            neighborhood: r.neighborhood,
            city: r.city,
            source: state.previousMode
        });

        const desc = cleanDescription(r.description);
        const duoUrl = r.url && !r.url.startsWith('http')
            ? `https://www.duogourmet.com.br${r.url}`
            : r.url;

        const googleMapsLink = r.google_maps_url
            || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address || r.city}`)}`;

        const isLocalFile = window.location.protocol === 'file:';
        const mapBaseUrl = isLocalFile
            ? '../duolistgit/index.html'
            : 'https://rogerioc.github.io/gourmet-map/';
        const gourmetMapUrl = `${mapBaseUrl}?r=${encodeURIComponent(r.slug || r.name)}`;

        const gameShareUrl = isLocalFile
            ? `https://rogerioc.github.io/gourmet-game/?winner=${encodeURIComponent(r.slug || r.id)}`
            : `${window.location.origin}${window.location.pathname}?winner=${encodeURIComponent(r.slug || r.id)}`;

        const shareText = `🍽️ Nosso restaurante de hoje foi decidido no Gourmet Game:\n*${r.name}* (${r.cuisine} • ${r.neighborhood}, ${r.city})!\n📍 Endereço: ${r.address || r.neighborhood}\n🔗 Veja os detalhes e horários: ${gameShareUrl}\nTopa?`;
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

        const highlightsHTML = Array.isArray(r.highlights) && r.highlights.length > 0
            ? `<div class="card-highlights" style="margin-bottom: 10px;">${r.highlights.map(h => `<span class="highlight-pill"><i class="fa-solid fa-fire-flame-curved" aria-hidden="true"></i> ${h}</span>`).join('')}</div>`
            : '';

        const recommendations = computeAffinityRecommendations(r);
        const affinityHTML = recommendations.length > 0 ? `
            <div class="affinity-section">
                <div class="affinity-header">
                    <h3><i class="fa-solid fa-wand-magic-sparkles" style="color: var(--accent);"></i> Plano B Inteligente (Baseado nas suas escolhas de hoje)</h3>
                    <span style="font-size: 12px; color: var(--text-subtle);">Caso o campeão tenha fila ou você queira comparar</span>
                </div>
                <div class="affinity-grid">
                    ${recommendations.map(item => `
                        <div class="affinity-card">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 4px;">
                                    <span class="cuisine-tag" style="background-color: ${item.restaurant.color}; font-size: 10px; padding: 2px 8px;">${item.restaurant.cuisine}</span>
                                    <span class="affinity-score-badge">${item.matchPct}% match</span>
                                </div>
                                <strong style="font-size: 15px; display: block;">${item.restaurant.name}</strong>
                                <span style="font-size: 12px; color: var(--text-muted);">
                                    📍 ${item.restaurant.neighborhood} ${item.dist < 50 ? `• a ${item.dist.toFixed(1)} km` : ''}
                                </span>
                            </div>
                            <button type="button" class="btn-secondary" data-promote-id="${item.restaurant.id}" style="width: 100%; justify-content: center; font-size: 12px; padding: 6px 10px;">
                                Escolher este Plano B
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';

        const contentEl = document.getElementById('championCardContent');
        contentEl.innerHTML = `
            <div class="champion-banner">
                <div>
                    <div class="champion-badge-row">
                        <i class="fa-solid fa-crown" aria-hidden="true"></i>
                        <span>${badgeLabel}</span>
                    </div>
                    <h2 id="champion-heading" tabindex="-1">${r.name}</h2>
                    <p>
                        <span><i class="fa-solid fa-utensils" aria-hidden="true"></i> ${r.cuisine}</span>
                        <span>•</span>
                        <span><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${r.neighborhood}, ${r.city}</span>
                        ${r.rating && r.rating !== 'N/A' ? `<span>• ⭐ ${r.rating}</span>` : ''}
                    </p>
                </div>
                <button type="button" class="btn-secondary" id="backFromChampionBtn">
                    <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                    Jogar Novamente
                </button>
            </div>

            <div class="champion-grid">
                <div class="champion-details">
                    <div>
                        <h3 style="font-size: 15px; margin-bottom: 8px;">Sobre a experiência</h3>
                        ${highlightsHTML}
                        <p class="champion-description">${desc}</p>
                    </div>

                    <div>
                        <h3 style="font-size: 15px; margin-bottom: 8px;"><i class="fa-regular fa-clock" style="color: var(--accent);"></i> Horários do Benefício</h3>
                        ${buildScheduleTableHTML(r.schedule)}
                    </div>
                </div>

                <div class="champion-map-box">
                    <h3 style="font-size: 15px;"><i class="fa-solid fa-map-location-dot" style="color: var(--accent);"></i> Localização no Mapa</h3>
                    <div id="championMiniMap" class="mini-map"></div>
                    <p style="font-size: 13px; color: var(--text-muted);">
                        <i class="fa-solid fa-location-pin" style="color: var(--accent);"></i>
                        ${r.address || `${r.neighborhood} - ${r.city}`}
                        ${r.phone ? `<br><i class="fa-solid fa-phone" style="color: var(--accent); margin-top: 4px;"></i> ${r.phone}` : ''}
                    </p>
                </div>
            </div>

            ${affinityHTML}

            <div class="champion-actions">
                <a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn-action btn-whatsapp" data-umami-event="whatsapp_invite" data-umami-event-restaurant="${r.name}">
                    <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
                    Mandar Convite no WhatsApp
                </a>
                <button type="button" class="btn-action btn-secondary" id="copyInviteBtn" data-umami-event="copy_invite" data-umami-event-restaurant="${r.name}">
                    <i class="fa-regular fa-copy" aria-hidden="true"></i>
                    Copiar Convite
                </button>
                <a href="${gourmetMapUrl}" target="_blank" rel="noopener" class="btn-action btn-gourmet-map" data-umami-event="open_gourmet_map" data-umami-event-restaurant="${r.name}">
                    <i class="fa-solid fa-map" aria-hidden="true"></i>
                    Abrir no Gourmet Map BH
                </a>
                <a href="${googleMapsLink}" target="_blank" rel="noopener" class="btn-action btn-google-maps" data-umami-event="open_google_maps" data-umami-event-restaurant="${r.name}">
                    <i class="fa-solid fa-diamond-turn-right" aria-hidden="true"></i>
                    Como Chegar (Google Maps)
                </a>
                ${duoUrl ? `
                    <a href="${duoUrl}" target="_blank" rel="noopener" class="btn-action btn-duo-external" data-umami-event="open_duo_or_rw" data-umami-event-restaurant="${r.name}">
                        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                        ${r.is_duo ? 'Ver no Duo Gourmet' : 'Ver na Restaurant Week'}
                    </a>
                ` : ''}
            </div>
        `;

        contentEl.querySelectorAll('[data-promote-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetRest = ALL_RESTAURANTS.find(item => item.id === Number(btn.dataset.promoteId));
                if (targetRest) {
                    showChampionScreen(targetRest, 'Escolhido pelo Plano B Inteligente 🎯');
                }
            });
        });

        document.getElementById('backFromChampionBtn')?.addEventListener('click', () => {
            const target = state.previousMode === 'slot' ? 'slot' : 'battle';
            state.mode = target;
            if (target === 'battle') {
                initTournament(state.tournament.size);
                transitionToView('battle', 'battle-heading');
            } else {
                transitionToView('slot', 'slot-heading');
            }
        });

        document.getElementById('copyInviteBtn')?.addEventListener('click', () => {
            navigator.clipboard?.writeText(shareText);
            showToast('📋 Convite copiado para a área de transferência!');
        });

        transitionToView('champion', 'champion-heading');

        // Renderizar mapa Leaflet após a transição/exibição
        setTimeout(() => {
            renderMiniLeafletMap('championMiniMap', r, true);
        }, 120);
    }

    function renderMiniLeafletMap(containerId, r, isChampion) {
        const container = document.getElementById(containerId);
        if (!container || typeof L === 'undefined') return;

        if (isChampion && championMapInstance) {
            championMapInstance.remove();
            championMapInstance = null;
        }
        if (!isChampion && detailMapInstance) {
            detailMapInstance.remove();
            detailMapInstance = null;
        }

        const lat = Number(r.lat) || -19.932;
        const lon = Number(r.lon) || -43.938;

        const mapInstance = L.map(containerId).setView([lat, lon], 16);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            maxZoom: 19
        }).addTo(mapInstance);

        const marker = L.circleMarker([lat, lon], {
            radius: 10,
            fillColor: r.color || '#d97706',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.95
        }).addTo(mapInstance);

        marker.bindPopup(`<strong>${r.name}</strong><br>${r.neighborhood}`).openPopup();

        if (isChampion) championMapInstance = mapInstance;
        else detailMapInstance = mapInstance;
    }

    // ========================================================
    // MODAIS NATIVOS (<dialog closedby="any">)
    // ========================================================
    function openRestaurantDetailsModal(restaurantId) {
        const r = ALL_RESTAURANTS.find(item => item.id === Number(restaurantId));
        if (!r) return;

        const dialog = document.getElementById('detailsDialog');
        const titleEl = document.getElementById('detailsDialogTitle');
        const bodyEl = document.getElementById('detailsDialogBody');

        titleEl.textContent = r.name;
        bodyEl.innerHTML = `
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                <span class="cuisine-tag" style="background-color: ${r.color};">${r.cuisine}</span>
                <span style="font-size: 13px; color: var(--text-muted);"><i class="fa-solid fa-location-dot" style="color: var(--accent);"></i> ${r.address || `${r.neighborhood}, ${r.city}`}</span>
            </div>
            <p class="card-description" style="-webkit-line-clamp: unset;">${cleanDescription(r.description)}</p>
            <div id="modalDetailMap" class="mini-map" style="height: 210px;"></div>
            <div>
                <h3 style="font-size: 14px; margin-bottom: 6px;">Horários Cadastrados</h3>
                ${buildScheduleTableHTML(r.schedule)}
            </div>
        `;

        dialog.showModal();
        setTimeout(() => {
            renderMiniLeafletMap('modalDetailMap', r, false);
        }, 80);
    }

    // Renderiza diagrama vetorial interativo da chave usando SVG.js (awesome-ai-arsenal Cat. 6)
    function renderSvgBracketDiagram(containerId) {
        const container = document.getElementById(containerId);
        if (!container || typeof window.SVG !== 'function') return;
        container.innerHTML = '';

        const rounds = state.tournament.rounds;
        if (!rounds.length) return;

        const colWidth = 210;
        const boxW = 175;
        const boxH = 54;
        const firstRoundCount = rounds[0].matches.length;
        const svgWidth = Math.max(580, rounds.length * colWidth + 40);
        const svgHeight = Math.max(200, firstRoundCount * (boxH + 22) + 30);

        const draw = window.SVG().addTo(container).size(svgWidth, svgHeight);
        const coordsByRound = [];

        rounds.forEach((round, rIdx) => {
            const x = 16 + rIdx * colWidth;
            const matchCenters = [];

            round.matches.forEach((m, mIdx) => {
                let centerY;
                if (rIdx === 0) {
                    centerY = 24 + mIdx * (boxH + 22) + boxH / 2;
                } else {
                    const prevCenters = coordsByRound[rIdx - 1];
                    const p1 = prevCenters[mIdx * 2] ?? 50;
                    const p2 = prevCenters[mIdx * 2 + 1] ?? p1;
                    centerY = (p1 + p2) / 2;

                    // Desenhar conectores curvos de Bézier da rodada anterior para a atual
                    const prevX = 16 + (rIdx - 1) * colWidth + boxW;
                    const midX = (prevX + x) / 2;
                    [p1, p2].forEach(py => {
                        draw
                            .path(`M ${prevX} ${py} C ${midX} ${py}, ${midX} ${centerY}, ${x} ${centerY}`)
                            .fill('none')
                            .stroke({ color: '#f59e0b', width: 2, opacity: 0.75 });
                    });
                }

                matchCenters.push(centerY);
                const y = centerY - boxH / 2;

                draw
                    .rect(boxW, boxH)
                    .move(x, y)
                    .radius(8)
                    .fill('#1e293b')
                    .stroke({ color: m.winner ? '#22c55e' : '#475569', width: 1.5 });

                const truncate = (str) => (str && str.length > 21 ? `${str.slice(0, 20)}…` : str || '');
                const aColor = m.winner ? (m.winner.id === m.a.id ? '#4ade80' : '#94a3b8') : '#f8fafc';
                const bColor = m.winner ? (m.winner.id === m.b.id ? '#4ade80' : '#94a3b8') : '#f8fafc';

                draw
                    .text(truncate(m.a.name))
                    .move(x + 10, y + 8)
                    .font({ family: 'Outfit, sans-serif', size: 11, weight: m.winner?.id === m.a.id ? '700' : '500' })
                    .fill(aColor);

                draw
                    .text(truncate(m.b.name))
                    .move(x + 10, y + 29)
                    .font({ family: 'Outfit, sans-serif', size: 11, weight: m.winner?.id === m.b.id ? '700' : '500' })
                    .fill(bColor);
            });

            coordsByRound.push(matchCenters);
        });
    }

    function openBracketModal() {
        const dialog = document.getElementById('bracketDialog');
        const bodyEl = document.getElementById('bracketDialogBody');

        let html = '<div id="svgBracketCanvas" class="svg-bracket-wrap" aria-label="Diagrama visual da chave"></div>';
        state.tournament.rounds.forEach(round => {
            html += `<div class="bracket-round-group"><h3>${round.name}</h3><div class="bracket-match-list">`;
            round.matches.forEach((m, idx) => {
                const aClass = m.winner ? (m.winner.id === m.a.id ? 'winner' : 'loser') : '';
                const bClass = m.winner ? (m.winner.id === m.b.id ? 'winner' : 'loser') : '';
                html += `
                    <div class="bracket-match-item">
                        <div style="font-size: 11px; color: var(--text-subtle); font-weight: 600;">Duelo ${idx + 1}</div>
                        <div class="bracket-team ${aClass}">
                            <span>${m.a.name}</span>
                            ${aClass === 'winner' ? '<i class="fa-solid fa-check"></i>' : ''}
                        </div>
                        <div class="bracket-team ${bClass}">
                            <span>${m.b.name}</span>
                            ${bClass === 'winner' ? '<i class="fa-solid fa-check"></i>' : ''}
                        </div>
                    </div>
                `;
            });
            html += `</div></div>`;
        });

        bodyEl.innerHTML = html;
        dialog.showModal();
        renderSvgBracketDiagram('svgBracketCanvas');
    }

    // Fallback obrigatório (modern-web-guidance) para light-dismiss em navegadores sem suporte a <dialog closedby="any">
    function setupDialogFallbacks() {
        const dialogs = document.querySelectorAll('dialog[closedby="any"]');
        dialogs.forEach(dialog => {
            dialog.addEventListener('close', () => {
                dialog.returnValue = '';
            });

            if (!('closedBy' in HTMLDialogElement.prototype)) {
                dialog.addEventListener('click', (event) => {
                    if (event.target !== dialog) return;
                    const rect = dialog.getBoundingClientRect();
                    const isDialogContent = (
                        rect.top <= event.clientY &&
                        event.clientY <= rect.top + rect.height &&
                        rect.left <= event.clientX &&
                        event.clientX <= rect.left + rect.width
                    );
                    if (isDialogContent) return;
                    dialog.close();
                });
            }
        });
    }

    let toastTimer = null;
    function showToast(msg) {
        const toast = document.getElementById('toastNotification');
        if (!toast) return;
        toast.textContent = msg;
        toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.hidden = true;
        }, 2800);
    }

    // ========================================================
    // EVENT LISTENERS
    // ========================================================
    function initEventListeners() {
        // Alternar abas de modo
        document.getElementById('tabBattle')?.addEventListener('click', () => {
            state.mode = 'battle';
            transitionToView('battle', 'battle-heading');
        });

        document.getElementById('tabSlot')?.addEventListener('click', () => {
            state.mode = 'slot';
            syncSlotMachineOptions();
            if (!state.slot.currentRestaurant) spinSlotMachine(false);
            transitionToView('slot', 'slot-heading');
        });

        document.getElementById('brandHomeLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            state.mode = 'battle';
            transitionToView('battle', 'battle-heading');
        });

        // Filtros de Contexto
        document.getElementById('filterCity')?.addEventListener('change', (e) => {
            state.filters.city = e.target.value;
            state.slot.lockedNeighborhood = false;
            state.slot.selectedNeighborhood = '';
            applyFiltersAndRefresh(true);
        });

        document.getElementById('filterCircuit')?.addEventListener('change', (e) => {
            state.filters.circuit = e.target.value;
            applyFiltersAndRefresh(true);
        });

        document.getElementById('filterMoment')?.addEventListener('change', (e) => {
            state.filters.moment = e.target.value;
            applyFiltersAndRefresh(true);
        });

        document.getElementById('filterCuisine')?.addEventListener('change', (e) => {
            state.filters.cuisine = e.target.value;
            applyFiltersAndRefresh(true);
        });

        // Controles da Copa do Jantar
        document.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const newSize = parseInt(btn.dataset.size, 10) || 8;
                initTournament(newSize);
            });
        });

        document.getElementById('newTournamentBtn')?.addEventListener('click', () => {
            initTournament(state.tournament.size);
            showToast('🎲 Nova chave sorteada!');
        });

        document.getElementById('openBracketBtn')?.addEventListener('click', openBracketModal);
        document.getElementById('rerollPairBtn')?.addEventListener('click', rerollCurrentPair);

        // Delegação de cliques nos cards (Escolher / Ver detalhes)
        document.addEventListener('click', (e) => {
            const pickBtn = e.target.closest('[data-pick-side]');
            if (pickBtn) {
                pickBattleWinner(pickBtn.dataset.pickSide);
                return;
            }

            const detailBtn = e.target.closest('[data-detail-id]');
            if (detailBtn) {
                openRestaurantDetailsModal(detailBtn.dataset.detailId);
            }
        });

        // Atalhos de teclado 1 / 2 ou Setas na Copa do Jantar
        document.addEventListener('keydown', (e) => {
            if (state.mode !== 'battle') return;
            if (document.querySelector('dialog[open]')) return;
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

            if (e.key === '1' || e.key === 'ArrowLeft') {
                e.preventDefault();
                pickBattleWinner('left');
            } else if (e.key === '2' || e.key === 'ArrowRight') {
                e.preventDefault();
                pickBattleWinner('right');
            }
        });

        // Controles da Roleta com Trava (Slot Machine)
        document.getElementById('lockCuisineBtn')?.addEventListener('click', () => {
            state.slot.lockedCuisine = !state.slot.lockedCuisine;
            syncSlotMachineOptions();
        });

        document.getElementById('lockNeighborhoodBtn')?.addEventListener('click', () => {
            state.slot.lockedNeighborhood = !state.slot.lockedNeighborhood;
            syncSlotMachineOptions();
        });

        document.getElementById('manualCuisineSelect')?.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                state.slot.selectedCuisine = val;
                state.slot.lockedCuisine = true;
            } else {
                state.slot.lockedCuisine = false;
            }
            syncSlotMachineOptions();
            spinSlotMachine(false);
        });

        document.getElementById('manualNeighborhoodSelect')?.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                state.slot.selectedNeighborhood = val;
                state.slot.lockedNeighborhood = true;
            } else {
                state.slot.lockedNeighborhood = false;
            }
            syncSlotMachineOptions();
            spinSlotMachine(false);
        });

        document.getElementById('unlockAllBtn')?.addEventListener('click', () => {
            state.slot.lockedCuisine = false;
            state.slot.lockedNeighborhood = false;
            syncSlotMachineOptions();
            showToast('🔓 Rolos destravados!');
        });

        document.getElementById('spinSlotBtn')?.addEventListener('click', () => {
            spinSlotMachine(true);
        });

        document.getElementById('acceptSlotWinnerBtn')?.addEventListener('click', () => {
            if (state.slot.currentRestaurant) {
                showChampionScreen(state.slot.currentRestaurant, 'Sorteado na Roleta Gourmet 🎰');
            }
        });
    }

    // Inicialização
    function init() {
        if (window.location.protocol === 'file:') {
            const topMapLink = document.getElementById('openFullMapLink');
            if (topMapLink) topMapLink.href = '../duolistgit/index.html';
        }

        setupDialogFallbacks();
        populateContextDropdowns();
        initEventListeners();
        applyFiltersAndRefresh(true);

        // Suporte a deep-link de compartilhamento (?winner=slug ou id)
        const params = new URLSearchParams(window.location.search);
        const winnerParam = params.get('winner');
        if (winnerParam) {
            const target = ALL_RESTAURANTS.find(
                r => r.slug === winnerParam || String(r.id) === winnerParam || r.name.toLowerCase() === winnerParam.toLowerCase()
            );
            if (target) {
                showChampionScreen(target, 'Convite Recebido • Restaurante de Hoje! 🥂');
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
