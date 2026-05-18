'use strict';

// ── DATA ─────────────────────────────────────────────────
const KEY = 'conselheiro_v1';

const defaults = {
  version: 1,
  config: {
    nome: null,
    alocacao: { investir: 30, cofrinho: 20, gastar: 50 },
    rendaFixa: { salario: 0, valeRefeicao: 0, valeTransporte: 0 },
    diaCorte: null,
  },
  transacoes: [],  // { id, tipo:'receita'|'gasto', valor, categoria?, descricao, data }
  parcelas: [],    // { id, descricao, valorParcela, total, pagas, dataInicio }
  objetivos: [],   // { id, tipo, nome, meta, atual }
  chat: [],        // { role:'user'|'moedinha', text, ts, split? }
};

let appData = JSON.parse(localStorage.getItem(KEY) || 'null') || defaults;

function save() {
  localStorage.setItem(KEY, JSON.stringify(appData));
}

// ── HELPERS ──────────────────────────────────────────────
function fmt(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function mkOf(dateStr) {
  return (dateStr || today()).slice(0, 7);
}

function nowMk() {
  return today().slice(0, 7);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function el(id) {
  return document.getElementById(id);
}

// ── SETUP ────────────────────────────────────────────────
function checkSetup() {
  if (!appData.config.nome) {
    el('setup').classList.remove('hidden');
    el('app').classList.add('hidden');
    bindAllocWatcher(['alloc-investir', 'alloc-cofrinho', 'alloc-gastar'], 'alloc-total');
  } else {
    el('setup').classList.add('hidden');
    el('app').classList.remove('hidden');
    init();
  }
}

function bindAllocWatcher(ids, totalId) {
  ids.forEach(id => el(id).addEventListener('input', () => updateAllocTotal(ids, totalId)));
}

function updateAllocTotal(ids, totalId) {
  const sum = ids.reduce((s, id) => s + (parseInt(el(id).value) || 0), 0);
  const t = el(totalId);
  t.textContent = `Total: ${sum}%${sum === 100 ? ' ✓' : ''}`;
  t.className = 'alloc-total' + (sum === 100 ? ' ok' : sum > 100 ? ' over' : '');
}

el('setup-btn').addEventListener('click', () => {
  const nome = el('setup-nome').value.trim();
  if (!nome) { showToast('Digite seu nome primeiro'); return; }
  const i = parseInt(el('alloc-investir').value) || 0;
  const c = parseInt(el('alloc-cofrinho').value) || 0;
  const g = parseInt(el('alloc-gastar').value) || 0;
  if (i + c + g !== 100) { showToast('As porcentagens precisam somar 100%'); return; }
  appData.config.nome = nome;
  appData.config.alocacao = { investir: i, cofrinho: c, gastar: g };
  save();
  checkSetup();
});

// ── NAVIGATION ───────────────────────────────────────────
let currentView = 'home';

function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  el(`view-${view}`).classList.add('active');
  document.querySelector(`.nav-btn[data-view="${view}"]`).classList.add('active');
  currentView = view;
  closeFab();
  renderView(view);
}

document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

function renderView(view) {
  if (view === 'home') renderHome();
  else if (view === 'wallet') renderWallet();
  else if (view === 'goals') renderGoals();
}

// ── FAB ──────────────────────────────────────────────────
let fabOpen = false;

el('fab').addEventListener('click', () => {
  fabOpen = !fabOpen;
  el('fab-menu').classList.toggle('hidden', !fabOpen);
  el('fab').classList.toggle('open', fabOpen);
});

function closeFab() {
  fabOpen = false;
  el('fab-menu').classList.add('hidden');
  el('fab').classList.remove('open');
}

document.addEventListener('click', e => {
  if (fabOpen && !e.target.closest('#fab-container')) closeFab();
});

el('fab-receita').addEventListener('click', () => { closeFab(); openModal('modal-receita'); });
el('fab-gasto').addEventListener('click', () => { closeFab(); openModal('modal-gasto'); });
el('fab-parcela-new').addEventListener('click', () => { closeFab(); openModal('modal-parcela'); });

// ── MODALS ───────────────────────────────────────────────
function openModal(id) {
  el(id).classList.remove('hidden');
  requestAnimationFrame(() => el(id).classList.add('show'));
}

function closeModal(id) {
  el(id).classList.remove('show');
  setTimeout(() => el(id).classList.add('hidden'), 250);
}

document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); });
});

// ── ADVISOR LOGIC ────────────────────────────────────────
function getAdvisor(mk) {
  mk = mk || nowMk();
  const cfg = appData.config.alocacao;
  const rf = appData.config.rendaFixa || {};
  const salario       = rf.salario       || 0;
  const valeRefeicao  = rf.valeRefeicao  || 0;
  const valeTransporte = rf.valeTransporte || 0;
  const totalRendaFixa = salario + valeRefeicao + valeTransporte;

  const receitasMes = appData.transacoes.filter(t => t.tipo === 'receita' && mkOf(t.data) === mk);
  const totalExtra  = receitasMes.reduce((s, t) => s + t.valor, 0);
  const totalReceita = totalRendaFixa + totalExtra;

  const parcelasAtivas = appData.parcelas.filter(p => p.pagas < p.total);
  const totalParcelas  = parcelasAtivas.reduce((s, p) => s + p.valorParcela, 0);

  // Dívidas saem primeiro; o que sobra é dividido nos buckets
  const rendaLivre = Math.max(0, totalReceita - totalParcelas);

  const bucketInvestir = rendaLivre * cfg.investir / 100;
  const bucketCofrinho = rendaLivre * cfg.cofrinho / 100;
  const bucketGastar   = rendaLivre * cfg.gastar   / 100;

  const gastosMes  = appData.transacoes.filter(t => t.tipo === 'gasto' && mkOf(t.data) === mk);
  const totalGasto = gastosMes.reduce((s, t) => s + t.valor, 0);

  const disponivel = bucketGastar - totalGasto;

  const now = new Date();
  const [y, m] = mk.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const diaHoje = (mk === nowMk()) ? now.getDate() : lastDay;
  const diasRest = Math.max(1, lastDay - diaHoje + 1);
  const porDia = rendaLivre > 0 ? disponivel / diasRest : 0;

  const percGasto = bucketGastar > 0
    ? Math.min(100, (totalGasto / bucketGastar) * 100)
    : 0;

  const debtRatio = totalReceita > 0 ? totalParcelas / totalReceita : 0;

  let status;
  if (totalReceita === 0) status = 'neutro';
  else if (totalParcelas >= totalReceita) status = 'vermelho';
  else if (disponivel <= 0) status = 'vermelho';
  else if (percGasto >= 80 || debtRatio >= 0.8) status = 'vermelho';
  else if (percGasto >= 60 || debtRatio >= 0.6) status = 'amarelo';
  else status = 'verde';

  // Acumulado all-time: renda fixa conta em cada mês com atividade + mês atual
  const allMks = new Set(appData.transacoes.map(t => mkOf(t.data)));
  allMks.add(nowMk());
  let totalReceitaAll = 0;
  allMks.forEach(monthKey => {
    totalReceitaAll += totalRendaFixa;
    totalReceitaAll += appData.transacoes
      .filter(t => t.tipo === 'receita' && mkOf(t.data) === monthKey)
      .reduce((s, t) => s + t.valor, 0);
  });
  const acumInvestir = totalReceitaAll * cfg.investir / 100;
  const acumCofrinho = totalReceitaAll * cfg.cofrinho / 100;

  return {
    totalReceita, totalExtra, salario, valeRefeicao, valeTransporte,
    rendaLivre,
    bucketInvestir, bucketCofrinho, bucketGastar,
    totalParcelas, totalGasto, disponivel, diasRest, porDia,
    percGasto, debtRatio, status, acumInvestir, acumCofrinho,
  };
}

// ── RENDER HOME ──────────────────────────────────────────
function renderHome() {
  const d = getAdvisor();
  const hour = new Date().getHours();
  const saudacao = hour < 12 ? 'Bom dia,' : hour < 18 ? 'Boa tarde,' : 'Boa noite,';
  el('greeting').textContent = saudacao;
  el('header-nome').textContent = appData.config.nome || 'Você';

  // Advisor card
  const card = el('advisor-card');
  card.className = 'advisor-card adv-' + d.status;
  el('badge-dot').className = 'badge-dot dot-' + d.status;

  if (d.totalReceita === 0) {
    el('badge-label').textContent = 'Sem renda configurada';
    el('advisor-msg').textContent = 'Configure seu salário e benefícios nas configurações (⚙️) para eu calcular seus limites.';
    el('advisor-value').textContent = '';
    el('advisor-detail').textContent = 'Ou toque em + para registrar uma renda extra';
  } else if (d.totalParcelas >= d.totalReceita) {
    el('badge-label').textContent = 'Dívidas críticas!';
    el('advisor-msg').textContent = 'Suas parcelas superam toda sua renda. Priorize renegociar suas dívidas agora.';
    el('advisor-value').textContent = fmt(d.totalParcelas - d.totalReceita) + ' além da sua renda';
    el('advisor-detail').textContent = 'Sem renda livre este mês';
  } else if (d.status === 'vermelho') {
    if (d.disponivel <= 0) {
      el('badge-label').textContent = 'Limite esgotado!';
      el('advisor-msg').textContent = 'Você ultrapassou seu limite de gastos este mês. Não gaste mais nada agora.';
      el('advisor-value').textContent = fmt(Math.abs(d.disponivel)) + ' acima do limite';
    } else {
      el('badge-label').textContent = 'Cuidado!';
      el('advisor-msg').textContent = d.debtRatio >= 0.8
        ? `Suas parcelas consomem ${Math.round(d.debtRatio * 100)}% da sua renda. Renda livre muito baixa.`
        : 'Você está quase no limite. Gaste só com o essencial.';
      el('advisor-value').textContent = 'Restam apenas ' + fmt(d.disponivel);
    }
    el('advisor-detail').textContent = d.diasRest + ' dias restantes no mês';
  } else if (d.status === 'amarelo') {
    el('badge-label').textContent = d.debtRatio >= 0.6 ? 'Dívidas altas' : 'Atenção';
    el('advisor-msg').textContent = d.debtRatio >= 0.6
      ? `Parcelas consomem ${Math.round(d.debtRatio * 100)}% da sua renda. Priorize quitar as menores.`
      : 'Você já gastou bastante. Ainda dá, mas pense bem antes de gastar.';
    el('advisor-value').textContent = 'Pode gastar mais ' + fmt(d.disponivel);
    el('advisor-detail').textContent = '~' + fmt(Math.max(0, d.porDia)) + '/dia pelos próximos ' + d.diasRest + ' dias';
  } else {
    el('badge-label').textContent = 'Tudo certo!';
    el('advisor-msg').textContent = 'Você está dentro do orçamento. Pode gastar tranquilo.';
    el('advisor-value').textContent = 'Disponível: ' + fmt(d.disponivel);
    el('advisor-detail').textContent = '~' + fmt(d.porDia) + '/dia pelos próximos ' + d.diasRest + ' dias';
  }

  // Buckets
  el('bv-invest').textContent = fmt(d.bucketInvestir);
  el('bp-invest').textContent = appData.config.alocacao.investir + '%';
  el('bv-save').textContent   = fmt(d.bucketCofrinho);
  el('bp-save').textContent   = appData.config.alocacao.cofrinho + '%';
  el('bv-spend').textContent  = fmt(d.bucketGastar);
  el('bp-spend').textContent  = appData.config.alocacao.gastar + '%';

  // Summary
  el('sum-renda').textContent = fmt(d.totalReceita);
  function showSubRow(rowId, valId, val) {
    el(rowId).classList.toggle('hidden', val <= 0);
    el(valId).textContent = fmt(val);
  }
  showSubRow('row-salario', 'sum-salario', d.salario);
  showSubRow('row-vr',      'sum-vr',      d.valeRefeicao);
  showSubRow('row-vt',      'sum-vt',      d.valeTransporte);
  showSubRow('row-extra',   'sum-extra',   d.totalExtra);

  // Parcelas como prioridade (deduções antes do split)
  const temParcelas = d.totalParcelas > 0;
  el('row-parcelas').classList.toggle('hidden', !temParcelas);
  el('div-renda-livre').classList.toggle('hidden', !temParcelas);
  el('row-renda-livre').classList.toggle('hidden', !temParcelas);
  if (temParcelas) {
    el('sum-parcelas').textContent = fmt(d.totalParcelas);
    el('sum-renda-livre').textContent = fmt(d.rendaLivre);
    el('sum-renda-livre').className = d.rendaLivre > 0 ? 'val-green' : 'val-red';
  }

  el('sum-gasto').textContent = fmt(d.totalGasto);
  const dispEl = el('sum-disponivel');
  dispEl.textContent = fmt(d.disponivel);
  dispEl.className = d.disponivel >= 0 ? 'val-green' : 'val-red';

  const prog = el('spend-prog');
  prog.style.width = Math.min(100, d.percGasto) + '%';
  prog.className = 'prog-bar ' + (d.percGasto >= 80 ? 'p-red' : d.percGasto >= 60 ? 'p-yellow' : 'p-green');

  el('prog-left').textContent  = fmt(d.totalGasto) + ' gasto';
  el('prog-right').textContent = fmt(Math.max(0, d.disponivel)) + ' restando';

  // Acumulado
  el('acum-invest').textContent = fmt(d.acumInvestir);
  el('acum-save').textContent   = fmt(d.acumCofrinho);
}

// ── RENDER WALLET ────────────────────────────────────────
let currentMonth = nowMk();
let walletFilter = 'all';

function renderWallet() {
  const mk = currentMonth;
  const [y, m] = mk.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  el('month-label').textContent = meses[parseInt(m) - 1] + ' ' + y;

  const list = el('tx-list');

  let txItems = appData.transacoes
    .filter(t => mkOf(t.data) === mk)
    .filter(t => walletFilter === 'all' || t.tipo === walletFilter)
    .sort((a, b) => b.data.localeCompare(a.data));

  let parcItems = [];
  if (walletFilter === 'all' || walletFilter === 'parcela') {
    parcItems = appData.parcelas
      .filter(p => p.pagas < p.total)
      .map(p => ({
        id: 'p_' + p.id,
        tipo: 'parcela',
        valor: p.valorParcela,
        descricao: p.descricao,
        data: mk + '-01',
        badge: (p.pagas + 1) + '/' + p.total,
        parcelaId: p.id,
      }));
  }

  const allItems = [...parcItems, ...txItems];

  if (allItems.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhuma transação neste mês</div>';
    return;
  }

  list.innerHTML = allItems.map(t => {
    const isR = t.tipo === 'receita';
    const isP = t.tipo === 'parcela';
    const icon = isR ? '💰' : isP ? '📋' : catIcon(t.categoria);
    const sign = isR ? '+' : '−';
    const cls  = isR ? 'tx-r' : isP ? 'tx-p' : 'tx-g';
    const sub  = t.badge ? `Parcela ${t.badge}` : (t.categoria || '');
    const date = t.data ? t.data.slice(5).replace('-', '/') : '';
    const action = isP
      ? `<button class="tx-action pay-btn" data-pid="${t.parcelaId}" title="Marcar como paga">✓</button>`
      : `<button class="tx-action del-btn" data-id="${t.id}" title="Excluir">×</button>`;
    return `
      <div class="tx-item ${cls}">
        <div class="tx-ico">${icon}</div>
        <div class="tx-info">
          <span class="tx-desc">${t.descricao || sub || 'Sem descrição'}</span>
          <span class="tx-sub">${sub && sub !== t.descricao ? sub + ' · ' : ''}${date}</span>
        </div>
        <div class="tx-right">
          <span class="tx-val">${sign}${fmt(t.valor)}</span>
          ${action}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remover esta transação?')) return;
      appData.transacoes = appData.transacoes.filter(t => t.id !== btn.dataset.id);
      save();
      renderWallet();
      renderHome();
    });
  });

  list.querySelectorAll('.pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = appData.parcelas.find(x => x.id === btn.dataset.pid);
      if (!p) return;
      if (!confirm(`Marcar parcela ${p.pagas + 1}/${p.total} como paga?`)) return;
      p.pagas++;
      save();
      renderWallet();
      renderHome();
    });
  });
}

el('prev-month').addEventListener('click', () => {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderWallet();
});

el('next-month').addEventListener('click', () => {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderWallet();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    walletFilter = btn.dataset.filter;
    renderWallet();
  });
});

function catIcon(cat) {
  const m = { 'Alimentação':'🍔','Transporte':'🚗','Lazer':'🎮','Saúde':'💊',
    'Educação':'📚','Moradia':'🏠','Roupas':'👕','Relacionamento':'💑',
    'Assinaturas':'📺','Outros':'📦' };
  return m[cat] || '📦';
}

// ── RENDER GOALS ─────────────────────────────────────────
function renderGoals() {
  const list = el('goals-list');
  if (appData.objetivos.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhum objetivo ainda.<br>Toque em ＋ para criar o primeiro.</div>';
    return;
  }

  list.innerHTML = appData.objetivos.map(g => {
    const perc = g.meta > 0 ? Math.min(100, (g.atual / g.meta) * 100) : 0;
    const falta = Math.max(0, g.meta - g.atual);
    const tag = goalTag(g.tipo);
    return `
      <div class="goal-card">
        <div class="goal-head">
          <div>
            <span class="goal-tag">${tag}</span>
            <h4 class="goal-name">${g.nome}</h4>
          </div>
          <button class="goal-del" data-id="${g.id}" title="Remover">×</button>
        </div>
        <div class="goal-bar-wrap">
          <div class="goal-bar"><div class="goal-fill" style="width:${perc}%"></div></div>
        </div>
        <div class="goal-vals">
          <span>${fmt(g.atual)}</span>
          <span class="goal-perc">${perc.toFixed(0)}%</span>
          <span>${fmt(g.meta)}</span>
        </div>
        <div class="goal-foot">
          <span class="goal-falta">Faltam ${fmt(falta)}</span>
          <button class="goal-upd-btn btn-sm" data-id="${g.id}">Atualizar valor</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.goal-upd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = appData.objetivos.find(o => o.id === btn.dataset.id);
      if (!g) return;
      el('goal-upd-id').value  = g.id;
      el('goal-upd-title').textContent = 'Atualizar: ' + g.nome;
      el('goal-upd-val').value = g.atual;
      openModal('modal-goal-upd');
    });
  });

  list.querySelectorAll('.goal-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remover este objetivo?')) return;
      appData.objetivos = appData.objetivos.filter(o => o.id !== btn.dataset.id);
      save();
      renderGoals();
    });
  });
}

function goalTag(tipo) {
  return { emergencia:'🛡️ Emergência', investimento:'📈 Investimento', sonho:'✨ Sonho', divida:'💸 Dívida' }[tipo] || tipo;
}

el('add-goal-btn').addEventListener('click', () => openModal('modal-goal'));

// ── MODAL: RECEITA ───────────────────────────────────────
el('receita-valor').addEventListener('input', () => {
  const v = parseFloat(el('receita-valor').value) || 0;
  const cfg = appData.config.alocacao;
  if (v > 0) {
    el('sp-ip').textContent = cfg.investir;
    el('sp-sp').textContent = cfg.cofrinho;
    el('sp-gp').textContent = cfg.gastar;
    el('sp-iv').textContent = fmt(v * cfg.investir / 100);
    el('sp-sv').textContent = fmt(v * cfg.cofrinho / 100);
    el('sp-gv').textContent = fmt(v * cfg.gastar   / 100);
    el('split-preview').classList.remove('hidden');
  } else {
    el('split-preview').classList.add('hidden');
  }
});

el('receita-cancel').addEventListener('click', () => closeModal('modal-receita'));
el('receita-ok').addEventListener('click', () => {
  const v = parseFloat(el('receita-valor').value);
  if (!v || v <= 0) { showToast('Informe um valor válido'); return; }
  const desc = el('receita-desc').value.trim() || 'Renda';
  appData.transacoes.push({ id: uid(), tipo: 'receita', valor: v, descricao: desc, data: today() });
  save();
  closeModal('modal-receita');
  el('receita-valor').value = '';
  el('receita-desc').value  = '';
  el('split-preview').classList.add('hidden');
  renderHome();
  triggerMascotReaction('income');
  const g = fmt(v * appData.config.alocacao.gastar / 100);
  showToast('💸 Renda registrada! ' + g + ' disponível para gastar.');
});

// ── MODAL: GASTO ─────────────────────────────────────────
el('gasto-cancel').addEventListener('click', () => closeModal('modal-gasto'));
el('gasto-ok').addEventListener('click', () => {
  const v = parseFloat(el('gasto-valor').value);
  if (!v || v <= 0) { showToast('Informe um valor válido'); return; }
  const cat  = el('gasto-cat').value;
  const desc = el('gasto-desc').value.trim() || cat;
  appData.transacoes.push({ id: uid(), tipo: 'gasto', valor: v, categoria: cat, descricao: desc, data: today() });
  save();
  closeModal('modal-gasto');
  el('gasto-valor').value = '';
  el('gasto-desc').value  = '';
  renderHome();
  triggerMascotReaction('expense');
  showToast('✅ Gasto registrado!');
});

// ── MODAL: PARCELA ───────────────────────────────────────
el('parc-cancel').addEventListener('click', () => closeModal('modal-parcela'));
el('parc-ok').addEventListener('click', () => {
  const desc  = el('parc-desc').value.trim();
  const valor = parseFloat(el('parc-valor').value);
  const total = parseInt(el('parc-total').value);
  const pagas = parseInt(el('parc-pagas').value) || 0;
  if (!desc)               { showToast('Informe uma descrição'); return; }
  if (!valor || valor <= 0){ showToast('Informe o valor da parcela'); return; }
  if (!total || total < 1) { showToast('Informe o total de parcelas'); return; }
  if (pagas >= total)      { showToast('Parcelas pagas não pode ser maior que o total'); return; }
  appData.parcelas.push({ id: uid(), descricao: desc, valorParcela: valor, total, pagas, dataInicio: today() });
  save();
  closeModal('modal-parcela');
  el('parc-desc').value  = '';
  el('parc-valor').value = '';
  el('parc-total').value = '';
  el('parc-pagas').value = '0';
  renderHome();
  showToast('📋 Parcela adicionada!');
});

// ── MODAL: OBJETIVO ──────────────────────────────────────
el('goal-cancel').addEventListener('click', () => closeModal('modal-goal'));
el('goal-ok').addEventListener('click', () => {
  const tipo  = el('goal-tipo').value;
  const nome  = el('goal-nome').value.trim();
  const meta  = parseFloat(el('goal-meta').value);
  const atual = parseFloat(el('goal-atual').value) || 0;
  if (!nome)              { showToast('Informe um nome'); return; }
  if (!meta || meta <= 0) { showToast('Informe o valor da meta'); return; }
  appData.objetivos.push({ id: uid(), tipo, nome, meta, atual });
  save();
  closeModal('modal-goal');
  el('goal-nome').value  = '';
  el('goal-meta').value  = '';
  el('goal-atual').value = '0';
  renderGoals();
  showToast('🎯 Objetivo criado!');
});

// ── MODAL: ATUALIZAR OBJETIVO ────────────────────────────
el('goal-upd-cancel').addEventListener('click', () => closeModal('modal-goal-upd'));
el('goal-upd-ok').addEventListener('click', () => {
  const id    = el('goal-upd-id').value;
  const atual = parseFloat(el('goal-upd-val').value);
  if (isNaN(atual) || atual < 0) { showToast('Informe um valor válido'); return; }
  const g = appData.objetivos.find(o => o.id === id);
  if (g) { g.atual = atual; save(); closeModal('modal-goal-upd'); renderGoals(); showToast('🎯 Objetivo atualizado!'); }
});

// ── CALCULATOR ───────────────────────────────────────────
let calcN = 1;

document.querySelectorAll('.parc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.parc-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calcN = parseInt(btn.dataset.n);
    const v = parseFloat(el('calc-valor').value);
    if (v > 0) runCalc(v, calcN);
  });
});

el('calc-btn').addEventListener('click', () => {
  const v = parseFloat(el('calc-valor').value);
  if (!v || v <= 0) { showToast('Informe um valor'); return; }
  runCalc(v, calcN);
});

function runCalc(valorTotal, n) {
  const d = getAdvisor();
  const valorParc = valorTotal / n;

  const parcelasFixas = appData.parcelas
    .filter(p => p.pagas < p.total)
    .reduce((s, p) => s + p.valorParcela, 0);

  const totalComprometido = parcelasFixas + valorParc;
  const limiteSeguro = d.bucketGastar * 0.35;
  const pct = d.bucketGastar > 0 ? (totalComprometido / d.bucketGastar) * 100 : 999;
  const pode = totalComprometido <= limiteSeguro && d.disponivel > valorParc;

  const maxParc = limiteSeguro > parcelasFixas
    ? Math.floor(valorTotal / (limiteSeguro - parcelasFixas))
    : 0;

  let status, icon, title, subtitle;
  if (d.totalReceita === 0) {
    status = 'neutro'; icon = '❓'; title = 'Sem dados'; subtitle = 'Registre sua renda primeiro';
  } else if (pode) {
    status = 'verde'; icon = '✅'; title = 'Pode comprar!'; subtitle = 'Dentro do seu orçamento';
  } else if (pct < 60) {
    status = 'amarelo'; icon = '⚠️'; title = 'Com cuidado'; subtitle = 'Vai comprometer o orçamento';
  } else {
    status = 'vermelho'; icon = '❌'; title = 'Não recomendado'; subtitle = 'Pesado demais para agora';
  }

  el('calc-result').classList.remove('hidden');
  const hdr = el('result-header');
  hdr.className = 'result-header rh-' + status;
  el('result-icon').textContent    = icon;
  el('result-title').textContent   = title;
  el('result-subtitle').textContent = subtitle;

  el('result-details').innerHTML = `
    <div class="detail-row"><span>Valor da parcela</span><strong>${fmt(valorParc)}/mês</strong></div>
    <div class="detail-row"><span>Suas parcelas atuais</span><strong>${fmt(parcelasFixas)}/mês</strong></div>
    <div class="detail-row"><span>Total comprometido</span><strong>${fmt(totalComprometido)}/mês</strong></div>
    <div class="detail-row">
      <span>% do limite de gastos</span>
      <strong class="${pct > 50 ? 'val-red' : 'val-green'}">${Math.round(pct)}%</strong>
    </div>`;

  let tip = '';
  if (status === 'verde') {
    tip = '💡 Ótima escolha! Você ainda terá ' + fmt(d.disponivel - valorParc) + ' disponíveis este mês.';
  } else if (maxParc > 0 && maxParc !== n) {
    tip = '💡 Parcelando em ' + maxParc + 'x (' + fmt(valorTotal / maxParc) + '/mês) ficaria mais confortável.';
  } else {
    tip = '💡 Limite seguro para parcelas: ' + fmt(limiteSeguro) + '/mês. Você já tem ' + fmt(parcelasFixas) + ' comprometidos.';
  }
  el('result-tip').textContent = tip;

  el('calc-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── SETTINGS ─────────────────────────────────────────────
el('settings-btn').addEventListener('click', () => {
  el('cfg-nome').value     = appData.config.nome || '';
  el('cfg-investir').value = appData.config.alocacao.investir;
  el('cfg-cofrinho').value = appData.config.alocacao.cofrinho;
  el('cfg-gastar').value   = appData.config.alocacao.gastar;
  const rf = appData.config.rendaFixa || {};
  el('cfg-salario').value    = rf.salario       || '';
  el('cfg-vr').value         = rf.valeRefeicao  || '';
  el('cfg-vt').value         = rf.valeTransporte || '';
  el('cfg-dia-corte').value  = appData.config.diaCorte || '';
  updateAllocTotal(['cfg-investir', 'cfg-cofrinho', 'cfg-gastar'], 'cfg-alloc-total');
  bindAllocWatcher(['cfg-investir', 'cfg-cofrinho', 'cfg-gastar'], 'cfg-alloc-total');
  openModal('modal-settings');
});

el('cfg-cancel').addEventListener('click', () => closeModal('modal-settings'));
el('cfg-ok').addEventListener('click', () => {
  const nome = el('cfg-nome').value.trim();
  if (!nome) { showToast('Informe seu nome'); return; }
  const i = parseInt(el('cfg-investir').value) || 0;
  const c = parseInt(el('cfg-cofrinho').value) || 0;
  const g = parseInt(el('cfg-gastar').value)   || 0;
  if (i + c + g !== 100) { showToast('As porcentagens precisam somar 100%'); return; }
  appData.config.nome = nome;
  appData.config.alocacao = { investir: i, cofrinho: c, gastar: g };
  appData.config.rendaFixa = {
    salario:        parseFloat(el('cfg-salario').value) || 0,
    valeRefeicao:   parseFloat(el('cfg-vr').value)      || 0,
    valeTransporte: parseFloat(el('cfg-vt').value)      || 0,
  };
  appData.config.diaCorte = parseInt(el('cfg-dia-corte').value) || null;
  save();
  closeModal('modal-settings');
  renderHome();
  showToast('✅ Configurações salvas!');
});

el('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'conselheiro_' + today() + '.json'; a.click();
  URL.revokeObjectURL(url);
});

el('reset-btn').addEventListener('click', () => {
  if (!confirm('Tem certeza? Isso apaga TODOS os seus dados.')) return;
  if (!confirm('Última chance. Confirmar exclusão?')) return;
  localStorage.removeItem(KEY);
  location.reload();
});

// ── MASCOT ───────────────────────────────────────────
function triggerMascotReaction(type) {
  const m = el('mascot-svg');
  m.classList.remove('react-jump', 'react-shake');
  void m.offsetWidth; // force reflow to restart animation
  m.classList.add(type === 'income' ? 'react-jump' : 'react-shake');
  m.addEventListener('animationend', () => {
    m.classList.remove('react-jump', 'react-shake');
  }, { once: true });
}

// ── TOAST ────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── CHAT ─────────────────────────────────────────────────
let chatPending = null; // { valor, tipo }

function openChat() {
  if (!appData.chat) appData.chat = [];
  if (appData.chat.length === 0) {
    const d = getAdvisor();
    const hora = new Date().getHours();
    const s = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const nome = appData.config.nome ? `, **${appData.config.nome}**` : '';
    let intro;
    if (d.totalReceita === 0) {
      intro = `${s}${nome}! 👋 Eu sou a Moedinha, sua conselheira financeira.\n\nSempre que você receber o salário ou uma renda extra, me conta aqui que eu te digo exatamente como dividir! 💰`;
    } else {
      const debtWarn = d.debtRatio > 0.5
        ? `Suas parcelas consomem **${Math.round(d.debtRatio * 100)}%** da renda, então sua renda livre é **${fmt(d.rendaLivre)}**.`
        : `Você tem **${fmt(d.disponivel)}** disponíveis para gastar este mês.`;
      intro = `${s}${nome}! 👋 ${debtWarn}\n\nMe conta se recebeu alguma renda nova, ou use os atalhos abaixo! 💰`;
    }
    chatPushMsg('moedinha', intro);
  }
  el('modal-chat').classList.remove('hidden');
  setTimeout(() => {
    renderChatMessages();
    const m = el('chat-msgs');
    if (m) m.scrollTop = m.scrollHeight;
  }, 50);
}

function closeChat() {
  el('modal-chat').classList.add('hidden');
}

function chatPushMsg(role, text, extra) {
  if (!appData.chat) appData.chat = [];
  appData.chat.push({ role, text, ts: Date.now(), ...extra });
  if (appData.chat.length > 80) appData.chat = appData.chat.slice(-80);
  save();
  renderChatMessages();
  setTimeout(() => {
    const m = el('chat-msgs');
    if (m) m.scrollTop = m.scrollHeight;
  }, 50);
}

function renderChatMessages() {
  const container = el('chat-msgs');
  if (!container) return;
  const msgs = appData.chat || [];

  container.innerHTML = msgs.map((msg, i) => {
    const isUser = msg.role === 'user';
    const timeStr = new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let html = msg.text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    if (msg.split) {
      const sp = msg.split;
      html += `<div class="chat-split-card">
        <div class="chat-split-row"><span>📈 Investir (${sp.pi}%)</span><strong>${sp.investir}</strong></div>
        <div class="chat-split-row"><span>🐷 Cofrinho (${sp.pc}%)</span><strong>${sp.cofrinho}</strong></div>
        <div class="chat-split-row"><span>💳 Para gastar (${sp.pg}%)</span><strong>${sp.gastar}</strong></div>
        ${sp.parcelas ? `<div class="chat-split-row chat-split-sep"><span>📋 − Parcelas</span><strong class="val-red">−${sp.parcelas}</strong></div>` : ''}
        ${sp.livre ? `<div class="chat-split-row"><span>✅ Renda livre</span><strong class="val-green">${sp.livre}</strong></div>` : ''}
      </div>`;
      if (i === msgs.length - 1 && chatPending) {
        html += `<button class="chat-confirm-btn" id="chat-confirm-btn">✅ Registrei no app — pode zerar!</button>`;
      }
    }

    if (isUser) {
      return `<div class="chat-row chat-row-user">
        <div class="chat-bubble chat-bubble-user">${html}</div>
        <span class="chat-time">${timeStr}</span>
      </div>`;
    }
    return `<div class="chat-row chat-row-moedinha">
      <span class="chat-avatar">🪙</span>
      <div>
        <div class="chat-bubble chat-bubble-moedinha">${html}</div>
        <span class="chat-time">${timeStr}</span>
      </div>
    </div>`;
  }).join('');

  const confirmBtn = el('chat-confirm-btn');
  if (confirmBtn) confirmBtn.addEventListener('click', chatHandleConfirm);

  renderChatChips();
}

function renderChatChips() {
  const chips = el('chat-chips');
  if (!chips) return;
  let html = '';
  if (chatPending) {
    html += `<button class="chat-chip chat-chip-primary" data-chip="confirmar">✅ Já coloquei no app</button>`;
    html += `<button class="chat-chip" data-chip="saldo">📊 Como estou?</button>`;
  } else {
    html += `<button class="chat-chip" data-chip="salario">💰 Recebi o salário</button>`;
    html += `<button class="chat-chip" data-chip="extra">🎉 Recebi um extra</button>`;
    html += `<button class="chat-chip" data-chip="saldo">📊 Como estou?</button>`;
  }
  chips.innerHTML = html;
  chips.querySelectorAll('.chat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.chip;
      if (c === 'confirmar') {
        chatPushMsg('user', 'Já coloquei no app!');
        setTimeout(chatHandleConfirm, 350);
      } else if (c === 'saldo') {
        chatPushMsg('user', 'Como estou?');
        setTimeout(chatHandleStatus, 350);
      } else if (c === 'salario') {
        el('chat-input').focus();
        el('chat-input').placeholder = 'Ex: recebi 3000';
      } else if (c === 'extra') {
        el('chat-input').focus();
        el('chat-input').placeholder = 'Ex: recebi 500 de freela';
      }
    });
  });
}

function chatSend() {
  const input = el('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.placeholder = 'Ex: recebi 3000...';
  chatPushMsg('user', text);
  setTimeout(() => {
    const intent = chatDetectIntent(text);
    if      (intent.type === 'income')    chatHandleIncome(intent.amount, 'salario');
    else if (intent.type === 'extra')     chatHandleIncome(intent.amount, 'extra');
    else if (intent.type === 'confirm')   chatHandleConfirm();
    else if (intent.type === 'status')    chatHandleStatus();
    else if (intent.type === 'spendDate') chatHandleSpendDate();
    else                                  chatHandleUnknown();
  }, 350);
}

function chatDetectIntent(text) {
  const t = text.toLowerCase().trim();
  const numMatch = t.match(/(\d+(?:[.,]\d+)?)/);
  const amount = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;

  const isIncome  = /recebi|ganhei|caiu|entrou|salário|salario|pagaram|me pagou/.test(t);
  const isExtra   = /extra|freela|bico|freelance|por fora|gorjeta|bonus|bônus/.test(t);
  const isConfirm = /coloquei|distribuí|distribui|feito|pronto|registrei|separei|ok feito|já fiz/.test(t);
  const isStatus  = /como (estou|tô|to)|quanto tenho|saldo|disponível|disponivel|situaç|posso gastar/.test(t);
  const isDate    = /quando posso|a partir de quando|que dia|dia corte|dia seguro/.test(t);

  if (amount && isIncome) return { type: isExtra ? 'extra' : 'income', amount };
  if (amount && isExtra)  return { type: 'extra', amount };
  if (isConfirm) return { type: 'confirm' };
  if (isStatus)  return { type: 'status' };
  if (isDate)    return { type: 'spendDate' };
  return { type: 'unknown' };
}

function chatHandleIncome(valor, tipo) {
  chatPending = { valor, tipo };
  const d   = getAdvisor();
  const cfg = appData.config.alocacao;
  const investir = valor * cfg.investir / 100;
  const cofrinho = valor * cfg.cofrinho / 100;
  const gastar   = valor * cfg.gastar   / 100;

  let parcStr = null, livreStr = null;
  if (d.totalParcelas > 0) {
    parcStr  = fmt(d.totalParcelas);
    livreStr = fmt(Math.max(0, gastar - d.totalParcelas));
  }

  let text = tipo === 'extra'
    ? `Boa, mais **${fmt(valor)}**! 🎉 Aqui está como dividir:`
    : `**${fmt(valor)}** recebidos! 💰 Veja como dividir:`;

  const diaCorte = appData.config.diaCorte;
  if (diaCorte) {
    const hoje = new Date().getDate();
    if (hoje < diaCorte) {
      text += `\n\n📅 Aguarda até o **dia ${diaCorte}** para começar a gastar — faltam ${diaCorte - hoje} dias. Paga as contas primeiro!`;
    } else {
      text += `\n\n✅ Já passou o dia ${diaCorte}, pode gastar tranquilo!`;
    }
  }

  text += `\n\nRegistra no app e toca em **"pode zerar!"** quando fizer!`;

  chatPushMsg('moedinha', text, {
    split: { pi: cfg.investir, pc: cfg.cofrinho, pg: cfg.gastar,
      investir: fmt(investir), cofrinho: fmt(cofrinho), gastar: fmt(gastar),
      parcelas: parcStr, livre: livreStr },
  });
}

function chatHandleConfirm() {
  if (!chatPending) {
    chatPushMsg('moedinha', 'Não tem nada pendente ainda. Me conta quando você receber uma renda! 😊');
    return;
  }
  const { valor, tipo } = chatPending;
  appData.transacoes.push({ id: uid(), tipo: 'receita', valor, descricao: tipo === 'extra' ? 'Renda extra' : 'Salário', data: today() });
  save();
  if (currentView === 'home') renderHome();
  chatPending = null;
  const ok = ['**Perfeito!** ✅ Dinheiro registrado. Agora é foco no objetivo! 🚀', '**Feito!** ✅ Tudo no lugar certo. Bom mês! 💪', '**Ótimo!** ✅ Zerado! Você tá no caminho certo. 🎯'];
  chatPushMsg('moedinha', ok[Math.floor(Math.random() * ok.length)]);
}

function chatHandleStatus() {
  const d = getAdvisor();
  if (d.totalReceita === 0) {
    chatPushMsg('moedinha', 'Ainda não tem renda registrada este mês. Me conta quando você receber! 💰');
    return;
  }
  const pct = Math.round(d.percGasto);
  let text;
  if (d.totalParcelas >= d.totalReceita) {
    text = `⚠️ Suas parcelas (**${fmt(d.totalParcelas)}**) superam sua renda!\n\nPrioridade urgente: renegociar as dívidas. Sem renda livre este mês.`;
  } else if (d.status === 'verde') {
    text = `Tudo certo! 🟢 Você usou **${pct}%** do limite.\n\nDisponível para gastar: **${fmt(d.disponivel)}**\n~**${fmt(d.porDia)}/dia** pelos próximos ${d.diasRest} dias.`;
  } else if (d.status === 'amarelo') {
    text = `Atenção! 🟡 Você já usou **${pct}%** do limite.\n\nAinda tem **${fmt(d.disponivel)}** — mas com ${d.diasRest} dias restantes, não dá pra forçar.`;
  } else {
    text = d.disponivel <= 0
      ? `Eita! 🔴 Você estourou o limite em **${fmt(Math.abs(d.disponivel))}** este mês.\n\nSegura as compras até o fim do mês. 🛑`
      : `Cuidado! 🔴 Usou **${pct}%** do limite. Restam só **${fmt(d.disponivel)}**.\n\nGasta só no essencial pelos próximos ${d.diasRest} dias.`;
  }
  chatPushMsg('moedinha', text);
}

function chatHandleSpendDate() {
  const diaCorte = appData.config.diaCorte;
  if (!diaCorte) {
    chatPushMsg('moedinha', 'Você ainda não configurou um dia seguro. Vai em ⚙️ Configurações e preenche o **"Dia seguro para gastar"** — é o dia em que todas as suas contas já estão pagas!');
    return;
  }
  const hoje = new Date().getDate();
  if (hoje < diaCorte) {
    chatPushMsg('moedinha', `📅 Aguarda até o **dia ${diaCorte}** para gastar à vontade. Faltam **${diaCorte - hoje} dias**. Segura a emoção! 😄`);
  } else {
    chatPushMsg('moedinha', `✅ Já passou do dia ${diaCorte}! Pode gastar tranquilo. Você tem **${fmt(getAdvisor().disponivel)}** disponíveis.`);
  }
}

function chatHandleUnknown() {
  const dicas = [
    'Não entendi bem. 😅 Tenta assim:\n\n• "recebi 3000" — pra eu dividir\n• "como estou?" — pra ver seu saldo',
    'Hm, não peguei! Me diz um valor que você recebeu e eu te ajudo a dividir. 💰',
    'Não entendi, mas tudo bem! Usa os atalhos abaixo pra me contar o que aconteceu. 😊',
  ];
  chatPushMsg('moedinha', dicas[Math.floor(Math.random() * dicas.length)]);
}

el('chat-btn').addEventListener('click', openChat);
el('mascot-svg').addEventListener('click', openChat);
el('mascot-svg').style.cursor = 'pointer';
el('chat-close').addEventListener('click', closeChat);
el('chat-clear-btn').addEventListener('click', () => {
  if (!confirm('Limpar toda a conversa?')) return;
  appData.chat = [];
  chatPending = null;
  save();
  closeChat();
});
el('chat-send').addEventListener('click', chatSend);
el('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') chatSend(); });

// ── INIT ─────────────────────────────────────────────────
function init() {
  renderHome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

checkSetup();
