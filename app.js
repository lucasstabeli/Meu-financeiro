'use strict';

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════

const MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const CHART_COLORS = ['#d4a843','#22c55e','#60a5fa','#ef4444','#f59e0b','#a78bfa','#2dd4bf','#ec4899','#f97316','#84cc16'];

const DEFAULT = {
  version: 6,
  usuario: { nome: 'Você' },
  security: { pinHash: null, bioCredId: null, lockEnabled: false, bioEnabled: false },
  cdiAnual: 10.65,
  meses: {},
  nubank: {
    limite: 0,
    avulsos: {},
    parcelas: [],
    assinaturas: [],
    parcelasPagas: {}
  },
  cofrinhos: {
    nubank: { principal: 0, percCDI: 100, dataInicio: null },
    itau:   { principal: 0, percCDI: 100, dataInicio: null },
    btg:    { principal: 0, percCDI: 100, dataInicio: null }
  },
  itau:     { saldo: 0, transacoes: [] },
  btg:      { acoes: [] },
  dayTrade: { saldoInicial: 0, saldoAtual: 0, custoContrato: 0.5, operacoes: [] },
  historico: []
};

// ══════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════

let dados = JSON.parse(JSON.stringify(DEFAULT));
let currentYM   = ym();
let currentView = 'overview';
let charts      = {};
let saveTimer   = null;
let confirmResolve = null;
let pinBuffer   = '';
let setupBuffer = '';
let setupFirst  = '';
let isSetupConfirm = false;
let fabHintTimer = null;

// ══════════════════════════════════════════════════════════
//  YM HELPERS  (YYYY-MM strings)
// ══════════════════════════════════════════════════════════

function ym(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
}

function ymParts(s) {
  const [y, m] = s.split('-').map(Number);
  return { y, m }; // m is 1-indexed
}

function ymAdd(s, n) {
  const { y, m } = ymParts(s);
  const dt = new Date(y, m - 1 + n, 1);
  return ym(dt);
}

function ymDiff(from, to) {
  const a = ymParts(from), b = ymParts(to);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

function ymLabel(s) {
  const { y, m } = ymParts(s);
  return `${MES[m-1]} ${y}`;
}

function getMes(s) {
  if (!dados.meses[s]) dados.meses[s] = { receitas: 0, despesas: 0, categorias: {} };
  return dados.meses[s];
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  load();
  initCharts();
  updateGreeting();
  setInterval(updateGreeting, 60000);

  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Init lock
  if (dados.security.lockEnabled && dados.security.pinHash) {
    showLock();
  } else if (!dados.security.pinHash) {
    showSetup();
  } else {
    showApp();
  }

  // Init default date for DT
  const today = new Date().toISOString().split('T')[0];
  const dtInput = document.getElementById('in-dt-data');
  if (dtInput) dtInput.value = today;

  setupRadial();
});

// ══════════════════════════════════════════════════════════
//  GREETING
// ══════════════════════════════════════════════════════════

function updateGreeting() {
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = dados.usuario?.nome || 'Você';
  const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const now = new Date();
  const timeStr = `${dias[now.getDay()]}, ${now.getDate()} de ${MES[now.getMonth()]}`;
  setEl('greetingText', `${saudacao}, ${nome}`);
  setEl('greetingTime', timeStr);
}

// ══════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════

function prevMonth() { currentYM = ymAdd(currentYM, -1); updateAll(); }
function nextMonth() { currentYM = ymAdd(currentYM,  1); updateAll(); }

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  updateAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTab(prefix, tab, el) {
  el?.parentElement?.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el?.classList.add('active');
  document.querySelectorAll(`[id^="${prefix}-tab-"]`).forEach(e => e.classList.add('hidden'));
  document.getElementById(`${prefix}-tab-${tab}`)?.classList.remove('hidden');
}

// ══════════════════════════════════════════════════════════
//  UPDATE ALL
// ══════════════════════════════════════════════════════════

function updateAll() {
  const label = ymLabel(currentYM);
  ['periodLabel','dash-period','nu-period','it-period','bt-period','dt-period'].forEach(id => setEl(id, label));

  if (currentView === 'overview')   updateOverview();
  else if (currentView === 'dashboard') updateDashboard();
  else if (currentView === 'nubank')    updateNubank();
  else if (currentView === 'itau')      updateItau();
  else if (currentView === 'btg')       updateBTG();
  else if (currentView === 'daytrade')  updateDayTrade();

  scheduleSave();
}

// ══════════════════════════════════════════════════════════
//  CALCULATIONS
// ══════════════════════════════════════════════════════════

function calcCofrinho(bank) {
  const c = dados.cofrinhos[bank];
  if (!c.dataInicio || c.principal <= 0) return { total: c.principal, rendeu: 0 };
  const taxaDiaria = Math.pow(1 + dados.cdiAnual / 100, 1 / 365) - 1;
  const taxaEfetiva = taxaDiaria * (c.percCDI / 100);
  const dias = Math.max(0, Math.floor((Date.now() - new Date(c.dataInicio).getTime()) / 86400000));
  const total = c.principal * Math.pow(1 + taxaEfetiva, dias);
  return { total, rendeu: total - c.principal };
}

function calcNubank(ym_) {
  let parcelasVal = 0, assinaturasVal = 0;
  dados.nubank.parcelas.forEach(p => {
    const d = ymDiff(p.anoMesInicio, ym_);
    if (d >= 0 && d < p.numParcelas) parcelasVal += p.valorParcela;
  });
  dados.nubank.assinaturas.forEach(a => {
    if (ym_ >= a.anoMesInicio) assinaturasVal += a.valor;
  });
  const avulsos = (dados.nubank.avulsos[ym_] || []).reduce((s, x) => s + x.valor, 0);
  const total = parcelasVal + assinaturasVal + avulsos;
  return { parcelasVal, assinaturasVal, avulsos, total, disponivel: dados.nubank.limite - total };
}

function calcItau(ym_) {
  const txs = dados.itau.transacoes.filter(t => t.anoMes === ym_);
  const entradas = txs.filter(t => t.tipo === 'r').reduce((s, t) => s + t.valor, 0);
  const saidas   = txs.filter(t => t.tipo === 'd').reduce((s, t) => s + t.valor, 0);
  const saldoDisp = dados.itau.saldo + entradas - saidas;
  return { entradas, saidas, saldoDisp };
}

function calcBTG(ym_) {
  let posicao = 0, investido = 0, divMensal = 0, divAcum = 0;
  dados.btg.acoes.forEach(a => {
    posicao   += a.qtd * a.preco;
    investido += a.qtd * a.pm;
    const dm = (a.divMensal || 0) * a.qtd;
    divMensal += dm;
    const meses = Math.max(0, ymDiff(a.anoMesCompra || currentYM, ym_));
    divAcum += dm * meses;
  });
  return { posicao, resultado: posicao - investido, divMensal, divAcum };
}

function calcDTMes(ym_) {
  const ops = dados.dayTrade.operacoes.filter(o => o.anoMes === ym_);
  const pl  = ops.reduce((s, o) => s + o.liquido, 0);
  return { ops, pl };
}

// ══════════════════════════════════════════════════════════
//  UPDATE: OVERVIEW
// ══════════════════════════════════════════════════════════

function updateOverview() {
  const mes      = getMes(currentYM);
  const nu       = calcNubank(currentYM);
  const it       = calcItau(currentYM);
  const bt       = calcBTG(currentYM);
  const cNu      = calcCofrinho('nubank');
  const cIt      = calcCofrinho('itau');
  const cBt      = calcCofrinho('btg');
  const cofTotal = cNu.total + cIt.total + cBt.total;
  const invTotal = bt.posicao;
  const patrimonioReal = it.saldoDisp + (nu.disponivel < 0 ? nu.disponivel : 0);
  const patrimonio     = patrimonioReal + cofTotal + invTotal;
  const saldo = mes.receitas - mes.despesas;

  setEl('ov-patrimonio',    fmt(patrimonio));
  setEl('ov-receitas',      fmt(mes.receitas));
  setEl('ov-despesas',      fmt(mes.despesas));
  setEl('ov-saldo',         fmt(saldo));
  setEl('ov-cofrinhos',     fmt(cofTotal));
  setEl('ov-investimentos', fmt(invTotal));
  setEl('ov-nubank-livre',  fmt(nu.disponivel));

  const perc = mes.receitas > 0 ? ((saldo / mes.receitas) * 100).toFixed(1) + '%' : '0%';
  setEl('ov-economia', perc);
  setElClass('ov-saldo', 'balance-col-value ' + (saldo >= 0 ? 'positive' : 'negative'));
  setElClass('ov-economia', 'stat-value ' + (saldo >= 0 ? 'positive' : 'negative'));
  setElClass('ov-nubank-livre', 'stat-value ' + (nu.disponivel >= 0 ? 'neutral' : 'negative'));

  // Cofrinhos table
  const banks = ['nu','it','bt'];
  const cofData = [cNu, cIt, cBt];
  banks.forEach((b, i) => {
    setEl(`cof-${b}-p`, fmt(cofData[i].total === cofData[i].rendeu ? 0 : cofData[i].total - cofData[i].rendeu));
    setEl(`cof-${b}-r`, '+' + fmt(cofData[i].rendeu));
    setEl(`cof-${b}-t`, fmt(cofData[i].total));
  });
  const totP  = dados.cofrinhos.nubank.principal + dados.cofrinhos.itau.principal + dados.cofrinhos.btg.principal;
  const totR  = cNu.rendeu + cIt.rendeu + cBt.rendeu;
  setEl('cof-tot-p', fmt(totP));
  setEl('cof-tot-r', '+' + fmt(totR));
  setEl('cof-tot-t', fmt(cofTotal));

  // Evolução chart
  const labels = [], recArr = [], despArr = [];
  for (let i = 0; i < 12; i++) {
    const base = ymAdd(currentYM, i - 11);
    labels.push(ymLabel(base).slice(0, 3));
    const m = dados.meses[base] || { receitas: 0, despesas: 0 };
    recArr.push(m.receitas);
    despArr.push(m.despesas);
  }
  updateChart('evolucao', {
    labels,
    datasets: [
      { label: 'Receitas',  data: recArr,  backgroundColor: '#22c55e', borderRadius: 5 },
      { label: 'Despesas',  data: despArr, backgroundColor: '#ef4444', borderRadius: 5 }
    ]
  });

  // Categorias chart
  const cats = mes.categorias;
  const catKeys = Object.keys(cats).filter(k => cats[k] > 0);
  updateChart('categorias', {
    labels: catKeys.length ? catKeys : ['Sem dados'],
    datasets: [{ data: catKeys.length ? catKeys.map(k => cats[k]) : [1], backgroundColor: CHART_COLORS, borderWidth: 0 }]
  });

  renderRecentActivity();
}

// ══════════════════════════════════════════════════════════
//  UPDATE: DASHBOARD
// ══════════════════════════════════════════════════════════

function updateDashboard() {
  const mes   = getMes(currentYM);
  const prev  = getMes(ymAdd(currentYM, -1));
  const cats  = mes.categorias;
  const catKeys = Object.keys(cats).filter(k => cats[k] > 0).sort((a, b) => cats[b] - cats[a]);

  // Top categorias
  const topEl = document.getElementById('dash-top-cats');
  if (topEl) {
    if (!catKeys.length) {
      topEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">Nenhum gasto registrado neste mês</div></div>';
    } else {
      const maxVal = cats[catKeys[0]] || 1;
      topEl.innerHTML = '<div class="cat-bar-wrap">' + catKeys.slice(0, 7).map(k => {
        const pct = Math.round((cats[k] / maxVal) * 100);
        const prevVal = prev.categorias[k] || 0;
        const delta = prevVal > 0 ? ((cats[k] - prevVal) / prevVal * 100).toFixed(0) : null;
        const badge = delta !== null ? `<span style="font-size:10px;color:${Number(delta)>0?'var(--red)':'var(--green)'}">${Number(delta)>0?'▲':'▼'}${Math.abs(delta)}%</span>` : '';
        return `<div class="cat-bar">
          <div class="cat-bar-label">${k} ${badge}</div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
          <div class="cat-bar-val">${fmt(cats[k])}</div>
        </div>`;
      }).join('') + '</div>';
    }
  }

  // Comparativo chart
  const prevCats = Object.keys(prev.categorias).filter(k => prev.categorias[k] > 0);
  const allCats  = [...new Set([...catKeys.slice(0,5), ...prevCats.slice(0,5)])];
  updateChart('compare', {
    labels: allCats.length ? allCats : ['Sem dados'],
    datasets: [
      { label: ymLabel(ymAdd(currentYM,-1)), data: allCats.map(k => prev.categorias[k]||0), backgroundColor: 'rgba(96,165,250,.6)', borderRadius: 4 },
      { label: ymLabel(currentYM),           data: allCats.map(k => cats[k]||0),            backgroundColor: 'rgba(212,168,67,.7)',  borderRadius: 4 }
    ]
  });

  // Projeção
  const projEl = document.getElementById('dash-projection');
  if (projEl) {
    const hoje      = new Date().getDate();
    const diasMes   = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
    const isCurrentMonth = currentYM === ym();
    if (isCurrentMonth && hoje > 0 && mes.despesas > 0) {
      const projetado = (mes.despesas / hoje) * diasMes;
      const sobra = mes.receitas - projetado;
      projEl.innerHTML = `
        <div class="card">
          <div style="font-size:12px;color:var(--text-2);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Projeção (baseada em ${hoje} dias)</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <div><div style="font-size:11px;color:var(--text-2)">Gasto até hoje</div><div style="font-size:17px;font-weight:800;color:var(--red)">${fmt(mes.despesas)}</div></div>
            <div><div style="font-size:11px;color:var(--text-2)">Projeção mês</div><div style="font-size:17px;font-weight:800;color:var(--orange)">${fmt(projetado)}</div></div>
            <div><div style="font-size:11px;color:var(--text-2)">Sobra prevista</div><div style="font-size:17px;font-weight:800;color:${sobra>=0?'var(--green)':'var(--red)'}">${fmt(sobra)}</div></div>
          </div>
        </div>`;
    } else {
      projEl.innerHTML = `<div class="card" style="text-align:center;color:var(--text-2);font-size:13px">Projeção disponível apenas para o mês atual</div>`;
    }
  }

  // Alertas
  const alertEl = document.getElementById('dash-alerts');
  if (alertEl) {
    const alerts = [];
    const nu = calcNubank(currentYM);
    if (nu.disponivel < 0) alerts.push({ type:'danger', icon:'💳', msg: `Nubank acima do limite em ${fmt(Math.abs(nu.disponivel))}` });
    if (dados.nubank.limite > 0 && nu.total / dados.nubank.limite > 0.8)
      alerts.push({ type:'warn', icon:'⚠️', msg: `${Math.round(nu.total/dados.nubank.limite*100)}% do limite Nubank usado` });
    if (mes.despesas > mes.receitas && mes.receitas > 0)
      alerts.push({ type:'danger', icon:'📉', msg: `Despesas superam receitas em ${fmt(mes.despesas - mes.receitas)}` });
    if (dados.nubank.assinaturas.length > 0) {
      const totalAssin = dados.nubank.assinaturas.filter(a => currentYM >= a.anoMesInicio).reduce((s,a)=>s+a.valor,0);
      if (mes.despesas > 0 && totalAssin / mes.despesas > 0.3)
        alerts.push({ type:'warn', icon:'📋', msg: `Assinaturas representam ${Math.round(totalAssin/mes.despesas*100)}% das despesas` });
    }
    if (!alerts.length) alerts.push({ type:'ok', icon:'✅', msg: 'Nenhum alerta para este mês!' });
    alertEl.innerHTML = alerts.map(a => `<div class="alert-item ${a.type}">${a.icon} ${a.msg}</div>`).join('');
  }
}

// ══════════════════════════════════════════════════════════
//  UPDATE: NUBANK
// ══════════════════════════════════════════════════════════

function updateNubank() {
  const nu = calcNubank(currentYM);
  const disEl = document.getElementById('nu-disponivel');
  if (disEl) { disEl.textContent = fmt(nu.disponivel); disEl.className = 'balance-value ' + (nu.disponivel >= 0 ? 'positive' : 'negative'); }
  setEl('nu-usado', fmt(nu.total) + ' usado');
  setEl('nu-limite-txt', 'Limite: ' + fmt(dados.nubank.limite));
  setEl('nu-fixos',    fmt(nu.assinaturasVal));
  setEl('nu-parcelas', fmt(nu.parcelasVal));
  setEl('nu-avulsos',  fmt(nu.avulsos));
  setEl('nu-badge',    fmt(nu.total));

  const perc = dados.nubank.limite > 0 ? (nu.total / dados.nubank.limite) * 100 : 0;
  const prog = document.getElementById('nu-prog');
  if (prog) {
    prog.style.width = Math.min(100, perc) + '%';
    prog.className = 'progress-fill' + (perc > 90 ? ' danger' : perc > 70 ? ' warn' : '');
  }

  const cof = calcCofrinho('nubank');
  setEl('nu-cof-total',    fmt(cof.total));
  setEl('nu-cof-principal', fmt(dados.cofrinhos.nubank.principal));
  setEl('nu-cof-rendeu',    fmt(cof.rendeu));

  // Pre-fill cofrinho form
  setValue('in-cof-nu-p',    dados.cofrinhos.nubank.principal);
  setValue('in-cof-nu-perc', dados.cofrinhos.nubank.percCDI);
  setValue('in-cof-nu-data', dados.cofrinhos.nubank.dataInicio || '');
  setValue('in-cdi',         dados.cdiAnual);
  setValue('in-nu-limite',   dados.nubank.limite);

  renderParcelas();
  renderAssinaturas();
  renderNuAvulsos();
}

// ══════════════════════════════════════════════════════════
//  UPDATE: ITAÚ
// ══════════════════════════════════════════════════════════

function updateItau() {
  const it = calcItau(currentYM);
  const saldoEl = document.getElementById('it-saldo');
  if (saldoEl) { saldoEl.textContent = fmt(it.saldoDisp); saldoEl.className = 'balance-value ' + (it.saldoDisp >= 0 ? 'positive' : 'negative'); }
  setEl('it-entradas', fmt(it.entradas));
  setEl('it-saidas',   fmt(it.saidas));
  setEl('it-badge',    fmt(it.saldoDisp));

  const cof = calcCofrinho('itau');
  setEl('it-cof-total',     fmt(cof.total));
  setEl('it-cof-principal', fmt(dados.cofrinhos.itau.principal));
  setEl('it-cof-rendeu',    fmt(cof.rendeu));

  setValue('in-cof-it-p',    dados.cofrinhos.itau.principal);
  setValue('in-cof-it-perc', dados.cofrinhos.itau.percCDI);
  setValue('in-cof-it-data', dados.cofrinhos.itau.dataInicio || '');
  setValue('in-it-saldo',    dados.itau.saldo);

  renderItauTransacoes();
}

// ══════════════════════════════════════════════════════════
//  UPDATE: BTG
// ══════════════════════════════════════════════════════════

function updateBTG() {
  const bt = calcBTG(currentYM);
  const resEl = document.getElementById('bt-resultado');
  if (resEl) { resEl.textContent = fmt(bt.resultado); resEl.className = 'stat-value ' + (bt.resultado >= 0 ? 'positive' : 'negative'); }
  setEl('bt-posicao',    fmt(bt.posicao));
  setEl('bt-div-mensal', fmt(bt.divMensal));
  setEl('bt-div-acum',   fmt(bt.divAcum));
  setEl('bt-badge',      fmt(bt.posicao));

  const cof = calcCofrinho('btg');
  setEl('bt-cof-total',     fmt(cof.total));
  setEl('bt-cof-principal', fmt(dados.cofrinhos.btg.principal));
  setEl('bt-cof-rendeu',    fmt(cof.rendeu));

  setValue('in-cof-bt-p',    dados.cofrinhos.btg.principal);
  setValue('in-cof-bt-perc', dados.cofrinhos.btg.percCDI);
  setValue('in-cof-bt-data', dados.cofrinhos.btg.dataInicio || '');

  // Carteira chart
  const tickers = dados.btg.acoes.map(a => a.ticker);
  const valores  = dados.btg.acoes.map(a => a.qtd * a.preco);
  updateChart('carteira', {
    labels: tickers.length ? tickers : ['Sem ativos'],
    datasets: [{ data: valores.length ? valores : [1], backgroundColor: CHART_COLORS, borderWidth: 0 }]
  });

  renderAcoes();
}

// ══════════════════════════════════════════════════════════
//  UPDATE: DAY TRADE
// ══════════════════════════════════════════════════════════

function updateDayTrade() {
  const { ops, pl } = calcDTMes(currentYM);
  const plEl = document.getElementById('dt-pl');
  if (plEl) { plEl.textContent = fmt(pl); plEl.className = 'stat-value ' + (pl >= 0 ? 'positive' : 'negative'); }
  const saldoEl = document.getElementById('dt-saldo');
  if (saldoEl) { saldoEl.textContent = fmt(dados.dayTrade.saldoAtual); saldoEl.className = 'stat-value ' + (dados.dayTrade.saldoAtual >= 0 ? 'positive' : 'negative'); }
  setEl('dt-ops',   ops.length);
  setEl('dt-taxa',  fmt(dados.dayTrade.custoContrato));
  setEl('dt-badge', fmt(pl));

  setValue('in-dt-saldo', dados.dayTrade.saldoInicial);
  setValue('in-dt-custo', dados.dayTrade.custoContrato);

  // DT evolution chart (last 30 ops)
  const sorted = [...dados.dayTrade.operacoes].sort((a, b) => a.data.localeCompare(b.data));
  const dtLabels = sorted.map(o => o.data.slice(5));
  let running = dados.dayTrade.saldoInicial;
  const dtData = sorted.map(o => { running += o.liquido; return running; });
  updateChart('dt', {
    labels: dtLabels.length ? dtLabels : [''],
    datasets: [{
      label: 'Saldo', data: dtData.length ? dtData : [0],
      borderColor: '#d4a843', backgroundColor: 'rgba(212,168,67,.08)',
      borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3
    }]
  });

  renderDTOps();
}

// ══════════════════════════════════════════════════════════
//  RENDER: RECENT ACTIVITY
// ══════════════════════════════════════════════════════════

function renderRecentActivity() {
  const el = document.getElementById('recent-activity');
  if (!el) return;
  const hist = [...dados.historico].reverse().slice(0, 12);
  if (!hist.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">◆</div><div class="empty-text">Nenhuma transação registrada</div></div>';
    return;
  }
  el.innerHTML = hist.map(h => `
    <div class="list-item" style="margin:0 16px 6px">
      <div class="list-item-info">
        <div class="list-item-title">${h.desc || h.cat}</div>
        <div class="list-item-subtitle">${ymLabel(h.anoMes)} · ${h.cat} · ${h.banco || 'geral'}</div>
      </div>
      <div class="list-item-value ${h.tipo === 'r' ? 'positive' : 'negative'}">
        ${h.tipo === 'r' ? '+' : '−'}${fmt(h.valor)}
      </div>
      <div class="list-item-actions">
        <button class="btn-icon danger" onclick="removerHistorico('${h.id}')">✕</button>
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: PARCELAS
// ══════════════════════════════════════════════════════════

function renderParcelas() {
  const el = document.getElementById('lista-parcelas');
  if (!el) return;
  if (!dados.nubank.parcelas.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">💳</div><div class="empty-text">Nenhuma parcela cadastrada</div></div>';
    return;
  }
  el.innerHTML = dados.nubank.parcelas.map((p, idx) => {
    const d       = ymDiff(p.anoMesInicio, currentYM);
    const pAtual  = Math.min(d + 1, p.numParcelas);
    const quitada = d >= p.numParcelas;
    const ativa   = d >= 0 && !quitada;
    const prog    = Math.min(Math.round((d + 1) / p.numParcelas * 100), 100);
    const key     = `${p.id}_${currentYM}`;
    const pago    = !!dados.nubank.parcelasPagas[key];
    return `<div class="parcela-card" style="${pago ? 'opacity:.72' : ''}">
      <div class="parcela-top">
        <div class="parcela-info">
          <div class="parcela-name">
            ${p.desc}
            ${quitada ? '<span class="badge badge-success">✓ Quitada</span>' : ativa ? `<span class="badge badge-danger">${pAtual}/${p.numParcelas}</span>` : '<span class="badge badge-info">Em breve</span>'}
            ${pago ? '<span class="badge badge-success">💚 Pago</span>' : ''}
          </div>
          <div class="parcela-sub">${fmt(p.valorParcela)}/mês × ${p.numParcelas}x${ativa ? ` · restam ${p.numParcelas - d}` : ''}</div>
        </div>
        <div class="parcela-value">${ativa ? fmt(p.valorParcela) : '—'}</div>
      </div>
      ${ativa ? `<div class="progress-bg"><div class="progress-fill gold" style="width:${prog}%"></div></div>` : ''}
      <div class="parcela-actions">
        ${ativa ? `
          <button class="btn ${pago ? 'btn-success' : 'btn-gold'} btn-sm" style="flex:2" onclick="toggleParcela(${idx})">
            ${pago ? '✓ Pago' : '💸 Marcar pago'}
          </button>
          <button class="btn btn-secondary btn-sm" style="flex:2" onclick="anteciparParcela(${idx})">⚡ Antecipar</button>` : ''}
        <button class="btn-icon" onclick="editarParcela(${idx})">✏️</button>
        <button class="btn-icon danger" onclick="removerParcelaConfirm(${idx})">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: ASSINATURAS
// ══════════════════════════════════════════════════════════

function renderAssinaturas() {
  const el = document.getElementById('lista-assinaturas');
  if (!el) return;
  const lista = dados.nubank.assinaturas;
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">Nenhuma assinatura cadastrada</div></div>';
    return;
  }
  el.innerHTML = lista.map((a, i) => `
    <div class="list-item" style="margin:0 16px 6px">
      <div class="list-item-info">
        <div class="list-item-title">${a.desc}</div>
        <div class="list-item-subtitle">Desde ${ymLabel(a.anoMesInicio)}</div>
      </div>
      <div class="list-item-value negative">${fmt(a.valor)}/mês</div>
      <div class="list-item-actions">
        <button class="btn-icon" onclick="editarAssinatura(${i})">✏️</button>
        <button class="btn-icon danger" onclick="removerAssinaturaConfirm(${i})">🗑</button>
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: NUBANK AVULSOS
// ══════════════════════════════════════════════════════════

function renderNuAvulsos() {
  const el = document.getElementById('lista-nu-avulsos');
  if (!el) return;
  const lista = dados.nubank.avulsos[currentYM] || [];
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">💳</div><div class="empty-text">Nenhum lançamento avulso neste mês</div></div>';
    return;
  }
  el.innerHTML = lista.map((x, i) => `
    <div class="list-item" style="margin:0 16px 6px">
      <div class="list-item-info">
        <div class="list-item-title">${x.desc}</div>
        <div class="list-item-subtitle">${x.cat}</div>
      </div>
      <div class="list-item-value negative">−${fmt(x.valor)}</div>
      <div class="list-item-actions">
        <button class="btn-icon danger" onclick="removerAvulsoNu('${x.id}')">🗑</button>
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: ITAÚ TRANSAÇÕES
// ══════════════════════════════════════════════════════════

function renderItauTransacoes() {
  const el = document.getElementById('lista-itau');
  if (!el) return;
  const lista = dados.itau.transacoes.filter(t => t.anoMes === currentYM);
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏦</div><div class="empty-text">Nenhuma transação neste mês</div></div>';
    return;
  }
  el.innerHTML = [...lista].reverse().map(t => `
    <div class="list-item" style="margin:0 16px 6px;border-left:3px solid ${t.tipo==='r'?'var(--green)':'var(--red)'}">
      <div class="list-item-info">
        <div class="list-item-title">${t.desc}</div>
        <div class="list-item-subtitle">${t.cat} · Itaú ${t.tipo==='r'?'Receita':'Débito'}</div>
      </div>
      <div class="list-item-value ${t.tipo === 'r' ? 'positive' : 'negative'}">${t.tipo==='r'?'+':'−'}${fmt(t.valor)}</div>
      <div class="list-item-actions">
        <button class="btn-icon danger" onclick="removerItauTransacao('${t.id}')">🗑</button>
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: AÇÕES
// ══════════════════════════════════════════════════════════

function renderAcoes() {
  const el = document.getElementById('lista-acoes');
  if (!el) return;
  if (!dados.btg.acoes.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-text">Nenhum ativo na carteira</div></div>';
    return;
  }
  el.innerHTML = dados.btg.acoes.map((a, i) => {
    const inv  = a.qtd * a.pm;
    const atual = a.qtd * a.preco;
    const lucro = atual - inv;
    const rent  = inv > 0 ? ((lucro / inv) * 100).toFixed(2) : '0.00';
    const dm    = (a.divMensal || 0) * a.qtd;
    return `
    <div class="list-item" style="flex-direction:column;align-items:stretch;margin:0 16px 8px;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:18px;font-weight:900;letter-spacing:-.5px">${a.ticker}</div>
          <div class="list-item-subtitle">${a.qtd} ações · PM ${fmt(a.pm)}</div>
        </div>
        <div class="list-item-value ${lucro >= 0 ? 'positive' : 'negative'}" style="font-size:16px">${lucro>=0?'+':''}${fmt(lucro)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:12px;color:var(--text-2)">
        <div>Atual <span style="color:var(--text);font-weight:700">${fmt(a.preco)}</span></div>
        <div>Posição <span style="color:var(--text);font-weight:700">${fmt(atual)}</span></div>
        <div>Rent. <span style="color:${lucro>=0?'var(--green)':'var(--red)'};font-weight:700">${rent}%</span></div>
        ${dm > 0 ? `<div style="grid-column:1/-1">Div/mês <span style="color:var(--gold-2);font-weight:700">${fmt(dm)}</span></div>` : ''}
      </div>
      <div style="display:flex;gap:7px">
        <button class="btn btn-secondary btn-sm" style="flex:1" onclick="editarAcao(${i})">Editar</button>
        <button class="btn btn-danger btn-sm" style="flex:1" onclick="removerAcaoConfirm(${i})">Remover</button>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: DAY TRADE OPS
// ══════════════════════════════════════════════════════════

function renderDTOps() {
  const el = document.getElementById('lista-dt');
  if (!el) return;
  const ops = dados.dayTrade.operacoes.filter(o => o.anoMes === currentYM)
    .sort((a, b) => b.data.localeCompare(a.data));
  if (!ops.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">Nenhuma operação neste mês</div></div>';
    return;
  }
  el.innerHTML = ops.map(o => {
    const idx = dados.dayTrade.operacoes.findIndex(x => x.id === o.id);
    return `
    <div class="list-item" style="margin:0 16px 6px;border-left:3px solid ${o.tipo==='lucro'?'var(--green)':'var(--red)'}">
      <div class="list-item-info">
        <div class="list-item-title">${o.tipo==='lucro'?'▲':'▼'} ${new Date(o.data+'T00:00').toLocaleDateString('pt-BR')}</div>
        <div class="list-item-subtitle">${o.obs||'Sem obs'} · ${o.contratos} contratos · custo ${fmt(o.custo)}</div>
      </div>
      <div class="list-item-value ${o.tipo==='lucro'?'positive':'negative'}">${o.tipo==='lucro'?'+':''}${fmt(o.liquido)}</div>
      <div class="list-item-actions">
        <button class="btn-icon" onclick="editarDTOp(${idx})">✏️</button>
        <button class="btn-icon danger" onclick="removerDTOpConfirm(${idx})">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  ACTIONS — NUBANK
// ══════════════════════════════════════════════════════════

function salvarLimiteNubank() {
  const v = parseFloat(document.getElementById('in-nu-limite')?.value);
  if (isNaN(v) || v < 0) return toast('Valor inválido', 'error');
  dados.nubank.limite = v;
  updateAll();
  toast('Limite atualizado!');
}

function salvarParcela() {
  const idx  = parseInt(document.getElementById('ed-parcela-idx')?.value ?? '-1');
  const desc = document.getElementById('in-p-desc')?.value.trim();
  const val  = parseFloat(document.getElementById('in-p-valor')?.value);
  const num  = parseInt(document.getElementById('in-p-num')?.value);
  if (!desc || isNaN(val) || val <= 0 || isNaN(num) || num <= 0) return toast('Preencha todos os campos', 'error');
  if (idx >= 0) {
    const p = dados.nubank.parcelas[idx];
    p.desc = desc; p.valorParcela = val; p.numParcelas = num;
    toast('Parcela atualizada!');
  } else {
    dados.nubank.parcelas.push({ id: uid(), desc, valorParcela: val, numParcelas: num, anoMesInicio: currentYM });
    toast(`"${desc}" adicionada! ✓`);
  }
  closeModal('add-parcela');
  updateAll();
}

function previewParcela() {
  const v = parseFloat(document.getElementById('in-p-valor')?.value) || 0;
  const n = parseInt(document.getElementById('in-p-num')?.value) || 0;
  setEl('preview-parcela', `Total: ${fmt(v * n)}`);
}

function editarParcela(idx) {
  const p = dados.nubank.parcelas[idx];
  document.getElementById('modal-parcela-title').textContent = 'Editar Parcela';
  setValue('ed-parcela-idx', idx);
  setValue('in-p-desc',  p.desc);
  setValue('in-p-valor', p.valorParcela);
  setValue('in-p-num',   p.numParcelas);
  setEl('preview-parcela', `Total: ${fmt(p.valorParcela * p.numParcelas)}`);
  openModal('add-parcela');
}

function removerParcelaConfirm(idx) {
  const p = dados.nubank.parcelas[idx];
  showConfirm('Remover Parcela', `Remover "${p.desc}"?`, '🗑', 'Remover').then(ok => {
    if (!ok) return;
    dados.nubank.parcelas.splice(idx, 1);
    updateAll(); toast('Parcela removida');
  });
}

function toggleParcela(idx) {
  const p = dados.nubank.parcelas[idx];
  const key = `${p.id}_${currentYM}`;
  if (dados.nubank.parcelasPagas[key]) {
    delete dados.nubank.parcelasPagas[key];
    toast(`"${p.desc}" desmarcada`, 'info');
  } else {
    dados.nubank.parcelasPagas[key] = true;
    toast(`"${p.desc}" paga! 💚`);
  }
  updateAll();
}

function anteciparParcela(idx) {
  const p = dados.nubank.parcelas[idx];
  const d = ymDiff(p.anoMesInicio, currentYM);
  const restantes = p.numParcelas - d;
  if (restantes <= 0) return toast('Parcela já quitada!', 'info');
  const valorAnt = p.valorParcela * restantes;
  const it = calcItau(currentYM);
  if (it.saldoDisp < valorAnt) return toast(`Saldo Itaú insuficiente. Disponível: ${fmt(it.saldoDisp)}`, 'error');
  showConfirm('Antecipar Parcela', `${p.desc}\n${restantes} parcela(s) de ${fmt(p.valorParcela)}\nTotal: ${fmt(valorAnt)}\n\nDebita do Itaú e quita a compra.`, '⚡', 'Antecipar', 'btn-gold').then(ok => {
    if (!ok) return;
    dados.itau.transacoes.push({ id: uid(), tipo: 'd', desc: `Antecipação: ${p.desc}`, cat: 'Outros', valor: valorAnt, anoMes: currentYM });
    dados.nubank.parcelas.splice(idx, 1);
    addHistorico('d', 'itau', `Antecipação: ${p.desc}`, 'Outros', valorAnt);
    updateAll(); toast(`Antecipado! ${fmt(valorAnt)} debitado do Itaú ⚡`);
  });
}

function salvarAssinatura() {
  const idx  = parseInt(document.getElementById('ed-assin-idx')?.value ?? '-1');
  const desc = document.getElementById('in-a-desc')?.value.trim();
  const val  = parseFloat(document.getElementById('in-a-valor')?.value);
  if (!desc || isNaN(val) || val <= 0) return toast('Preencha todos os campos', 'error');
  if (idx >= 0) {
    dados.nubank.assinaturas[idx].desc = desc;
    dados.nubank.assinaturas[idx].valor = val;
    toast('Assinatura atualizada!');
  } else {
    dados.nubank.assinaturas.push({ id: uid(), desc, valor: val, anoMesInicio: currentYM });
    toast(`"${desc}" adicionada!`);
  }
  closeModal('add-assinatura');
  updateAll();
}

function editarAssinatura(idx) {
  const a = dados.nubank.assinaturas[idx];
  document.getElementById('modal-assin-title').textContent = 'Editar Assinatura';
  setValue('ed-assin-idx', idx);
  setValue('in-a-desc',  a.desc);
  setValue('in-a-valor', a.valor);
  openModal('add-assinatura');
}

function removerAssinaturaConfirm(idx) {
  const a = dados.nubank.assinaturas[idx];
  showConfirm('Remover Assinatura', `Remover "${a.desc}"?`, '🗑', 'Remover').then(ok => {
    if (!ok) return;
    dados.nubank.assinaturas.splice(idx, 1);
    updateAll(); toast('Assinatura removida');
  });
}

function removerAvulsoNu(id) {
  const lista = dados.nubank.avulsos[currentYM];
  if (!lista) return;
  const item = lista.find(x => x.id === id);
  if (!item) return;
  showConfirm('Remover lançamento', `Remover "${item.desc}"?`, '🗑', 'Remover').then(ok => {
    if (!ok) return;
    const mes = getMes(currentYM);
    mes.despesas = Math.max(0, mes.despesas - item.valor);
    mes.categorias[item.cat] = Math.max(0, (mes.categorias[item.cat] || 0) - item.valor);
    dados.nubank.avulsos[currentYM] = lista.filter(x => x.id !== id);
    dados.historico = dados.historico.filter(h => h.id !== id);
    updateAll(); toast('Lançamento removido');
  });
}

// ══════════════════════════════════════════════════════════
//  ACTIONS — ITAÚ
// ══════════════════════════════════════════════════════════

function salvarSaldoItau() {
  const v = parseFloat(document.getElementById('in-it-saldo')?.value);
  if (isNaN(v)) return toast('Valor inválido', 'error');
  dados.itau.saldo = v;
  updateAll(); toast('Saldo atualizado!');
}

function removerItauTransacao(id) {
  const t = dados.itau.transacoes.find(x => x.id === id);
  if (!t) return;
  showConfirm('Remover transação', `Remover "${t.desc}"?`, '🗑', 'Remover').then(ok => {
    if (!ok) return;
    const mes = getMes(currentYM);
    if (t.tipo === 'r') { mes.receitas = Math.max(0, mes.receitas - t.valor); }
    else { mes.despesas = Math.max(0, mes.despesas - t.valor); mes.categorias[t.cat] = Math.max(0, (mes.categorias[t.cat]||0) - t.valor); }
    dados.itau.transacoes = dados.itau.transacoes.filter(x => x.id !== id);
    dados.historico = dados.historico.filter(h => h.id !== id);
    updateAll(); toast('Transação removida');
  });
}

// ══════════════════════════════════════════════════════════
//  ACTIONS — BTG
// ══════════════════════════════════════════════════════════

function salvarAcao() {
  const idx    = parseInt(document.getElementById('ed-acao-idx')?.value ?? '-1');
  const ticker = document.getElementById('in-ac-ticker')?.value.toUpperCase().trim();
  const qtd    = parseInt(document.getElementById('in-ac-qtd')?.value);
  const pm     = parseFloat(document.getElementById('in-ac-pm')?.value);
  const preco  = parseFloat(document.getElementById('in-ac-atual')?.value);
  const divM   = parseFloat(document.getElementById('in-ac-div')?.value) || 0;
  if (!ticker || isNaN(qtd) || qtd <= 0 || isNaN(pm) || pm <= 0 || isNaN(preco) || preco <= 0)
    return toast('Preencha os campos obrigatórios', 'error');
  if (idx >= 0) {
    Object.assign(dados.btg.acoes[idx], { ticker, qtd, pm, preco, divMensal: divM });
    toast(`${ticker} atualizado!`);
  } else {
    dados.btg.acoes.push({ id: uid(), ticker, qtd, pm, preco, divMensal: divM, anoMesCompra: currentYM });
    toast(`${ticker} adicionado!`);
  }
  closeModal('add-acao');
  updateAll();
}

function editarAcao(idx) {
  const a = dados.btg.acoes[idx];
  document.getElementById('modal-acao-title').textContent = 'Editar Ativo';
  setValue('ed-acao-idx',  idx);
  setValue('in-ac-ticker', a.ticker);
  setValue('in-ac-qtd',    a.qtd);
  setValue('in-ac-pm',     a.pm);
  setValue('in-ac-atual',  a.preco);
  setValue('in-ac-div',    a.divMensal || 0);
  openModal('add-acao');
}

function removerAcaoConfirm(idx) {
  const a = dados.btg.acoes[idx];
  showConfirm('Remover Ativo', `Remover ${a.ticker} da carteira?`, '📉', 'Remover').then(ok => {
    if (!ok) return;
    dados.btg.acoes.splice(idx, 1);
    updateAll(); toast('Ativo removido');
  });
}

// ══════════════════════════════════════════════════════════
//  ACTIONS — DAY TRADE
// ══════════════════════════════════════════════════════════

function salvarConfDT() {
  const s = parseFloat(document.getElementById('in-dt-saldo')?.value);
  const c = parseFloat(document.getElementById('in-dt-custo')?.value);
  if (isNaN(s) || isNaN(c) || s < 0 || c < 0) return toast('Valores inválidos', 'error');
  dados.dayTrade.saldoInicial = s;
  dados.dayTrade.saldoAtual   = s;
  dados.dayTrade.custoContrato = c;
  updateAll(); toast('Configurações salvas!');
}

function salvarOperacaoDT() {
  const idx  = parseInt(document.getElementById('ed-dt-idx')?.value ?? '-1');
  const data = document.getElementById('in-dt-data')?.value;
  const tipo = document.getElementById('in-dt-tipo')?.value;
  const val  = parseFloat(document.getElementById('in-dt-valor')?.value);
  const cont = parseInt(document.getElementById('in-dt-contratos')?.value);
  const obs  = document.getElementById('in-dt-obs')?.value.trim();
  if (!data || isNaN(val) || val <= 0 || isNaN(cont) || cont <= 0) return toast('Preencha todos os campos', 'error');
  const custo  = cont * dados.dayTrade.custoContrato;
  const liquido = tipo === 'lucro' ? val - custo : -(val + custo);
  if (idx >= 0) {
    const old = dados.dayTrade.operacoes[idx];
    dados.dayTrade.saldoAtual -= old.liquido;
    Object.assign(old, { data, tipo, valor: val, contratos: cont, custo, liquido, obs });
    dados.dayTrade.saldoAtual += liquido;
    toast('Operação atualizada!');
  } else {
    dados.dayTrade.operacoes.push({ id: uid(), data, tipo, valor: val, contratos: cont, custo, liquido, obs, anoMes: currentYM });
    dados.dayTrade.saldoAtual += liquido;
    toast(`Operação de ${tipo === 'lucro' ? 'lucro' : 'prejuízo'} adicionada!`, tipo === 'lucro' ? 'success' : 'error');
  }
  closeModal('add-dt');
  updateAll();
}

function editarDTOp(idx) {
  const o = dados.dayTrade.operacoes[idx];
  document.getElementById('modal-dt-title').textContent = 'Editar Operação';
  setValue('ed-dt-idx',       idx);
  setValue('in-dt-data',      o.data);
  setValue('in-dt-tipo',      o.tipo);
  setValue('in-dt-valor',     o.valor);
  setValue('in-dt-contratos', o.contratos);
  setValue('in-dt-obs',       o.obs || '');
  openModal('add-dt');
}

function removerDTOpConfirm(idx) {
  showConfirm('Remover Operação', 'Remover esta operação?', '🗑', 'Remover').then(ok => {
    if (!ok) return;
    dados.dayTrade.saldoAtual -= dados.dayTrade.operacoes[idx].liquido;
    dados.dayTrade.operacoes.splice(idx, 1);
    updateAll(); toast('Operação removida');
  });
}

// ══════════════════════════════════════════════════════════
//  ACTIONS — COFRINHO
// ══════════════════════════════════════════════════════════

function salvarCofrinho(banco) {
  // banco = 'nubank' | 'itau' | 'btg'
  const short = { nubank: 'nu', itau: 'it', btg: 'bt' }[banco] || banco;
  const principal  = parseFloat(document.getElementById(`in-cof-${short}-p`)?.value) || 0;
  const percCDI    = parseFloat(document.getElementById(`in-cof-${short}-perc`)?.value) || 100;
  const dataInicio = document.getElementById(`in-cof-${short}-data`)?.value || null;
  dados.cofrinhos[banco] = { principal, percCDI, dataInicio };
  if (banco === 'nubank') {
    const cdi = parseFloat(document.getElementById('in-cdi')?.value);
    if (!isNaN(cdi) && cdi > 0) dados.cdiAnual = cdi;
  }
  updateAll(); toast(`Cofrinho ${banco.toUpperCase()} atualizado!`);
}

// ══════════════════════════════════════════════════════════
//  ACTIONS — TRANSACTION (bank-aware)
// ══════════════════════════════════════════════════════════

function salvarTransacao() {
  const banco = document.getElementById('tr-banco')?.value;
  const cat   = document.getElementById('tr-categoria')?.value;
  const desc  = document.getElementById('tr-desc')?.value.trim() || cat;
  const val   = parseFloat(document.getElementById('tr-valor')?.value);
  if (isNaN(val) || val <= 0) return toast('Insira um valor válido', 'error');
  const mes = getMes(currentYM);
  const id  = uid();

  if (banco === 'nubank') {
    if (!dados.nubank.avulsos[currentYM]) dados.nubank.avulsos[currentYM] = [];
    dados.nubank.avulsos[currentYM].push({ id, cat, desc, valor: val, ts: Date.now() });
    mes.despesas += val;
    mes.categorias[cat] = (mes.categorias[cat] || 0) + val;
    addHistorico('d', 'nubank', desc, cat, val, id);
  } else if (banco === 'itau-r') {
    dados.itau.transacoes.push({ id, tipo: 'r', desc, cat, valor: val, anoMes: currentYM });
    mes.receitas += val;
    addHistorico('r', 'itau', desc, cat, val, id);
  } else if (banco === 'itau-d') {
    dados.itau.transacoes.push({ id, tipo: 'd', desc, cat, valor: val, anoMes: currentYM });
    mes.despesas += val;
    mes.categorias[cat] = (mes.categorias[cat] || 0) + val;
    addHistorico('d', 'itau', desc, cat, val, id);
  } else if (banco === 'geral-r') {
    mes.receitas += val;
    addHistorico('r', 'geral', desc, cat, val, id);
  } else {
    mes.despesas += val;
    mes.categorias[cat] = (mes.categorias[cat] || 0) + val;
    addHistorico('d', 'geral', desc, cat, val, id);
  }
  closeModal('transaction');
  document.getElementById('tr-valor').value = '';
  document.getElementById('tr-desc').value  = '';
  updateAll();
  toast('Transação salva! ✓');
}

function addHistorico(tipo, banco, desc, cat, valor, id) {
  dados.historico.push({ id: id || uid(), tipo, banco, desc, cat, valor, anoMes: currentYM, ts: Date.now() });
}

function removerHistorico(id) {
  const h = dados.historico.find(x => x.id === id);
  if (!h) return;
  showConfirm('Remover registro', 'Remover este item do histórico?', '🗑', 'Remover').then(ok => {
    if (!ok) return;
    dados.historico = dados.historico.filter(x => x.id !== id);
    updateAll(); toast('Registro removido');
  });
}

// ══════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════

function openSettingsModal() {
  setValue('set-nome', dados.usuario.nome || '');
  const pinToggle = document.getElementById('toggle-pin');
  const bioToggle = document.getElementById('toggle-bio');
  if (pinToggle) pinToggle.className = 'toggle' + (dados.security.lockEnabled ? ' on' : '');
  if (bioToggle) bioToggle.className = 'toggle' + (dados.security.bioEnabled ? ' on' : '');
  openModal('settings');
}

function salvarSettings() {
  const nome = document.getElementById('set-nome')?.value.trim();
  if (nome) dados.usuario.nome = nome;
  closeModal('settings');
  updateGreeting();
  updateAll();
  toast('Configurações salvas!');
}

function togglePin() {
  if (dados.security.lockEnabled) {
    dados.security.lockEnabled = false;
    document.getElementById('toggle-pin').classList.remove('on');
    toast('Bloqueio desativado', 'info');
  } else {
    closeModal('settings');
    showSetup();
  }
  scheduleSave();
}

async function toggleBiometric() {
  if (dados.security.bioEnabled) {
    // Desativar
    dados.security.bioEnabled = false;
    dados.security.bioCredId  = null;
    document.getElementById('toggle-bio').classList.remove('on');
    toast('Face ID desativado', 'info');
    scheduleSave();
  } else {
    // Ativar: registra credencial no dispositivo
    const ok = await registerBiometric();
    if (ok) document.getElementById('toggle-bio').classList.add('on');
  }
}

function exportarDados() {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `wealthpro_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Dados exportados!');
}

function importarDados(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      dados = mergeDeep(JSON.parse(JSON.stringify(DEFAULT)), parsed);
      save();
      updateAll();
      toast('Dados importados com sucesso!');
    } catch { toast('Arquivo inválido', 'error'); }
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════════
//  MODAL SYSTEM
// ══════════════════════════════════════════════════════════

function openModal(name) {
  if (name === 'settings') { openSettingsModal(); return; }
  if (name === 'add-parcela') {
    document.getElementById('modal-parcela-title').textContent = 'Nova Parcela';
    setValue('ed-parcela-idx', -1);
    setValue('in-p-desc', ''); setValue('in-p-valor', ''); setValue('in-p-num', '');
    setEl('preview-parcela', 'Total: R$ 0,00');
  }
  if (name === 'add-assinatura') {
    document.getElementById('modal-assin-title').textContent = 'Nova Assinatura';
    setValue('ed-assin-idx', -1);
    setValue('in-a-desc', ''); setValue('in-a-valor', '');
  }
  if (name === 'add-acao') {
    document.getElementById('modal-acao-title').textContent = 'Novo Ativo';
    setValue('ed-acao-idx', -1);
    ['in-ac-ticker','in-ac-qtd','in-ac-pm','in-ac-atual','in-ac-div'].forEach(id => setValue(id, ''));
  }
  if (name === 'add-dt') {
    document.getElementById('modal-dt-title').textContent = 'Nova Operação';
    setValue('ed-dt-idx', -1);
    setValue('in-dt-data', new Date().toISOString().split('T')[0]);
    setValue('in-dt-tipo', 'lucro');
    ['in-dt-valor','in-dt-contratos','in-dt-obs'].forEach(id => setValue(id, ''));
  }
  document.getElementById(`modal-${name}`)?.classList.add('active');
}

function closeModal(name) {
  document.getElementById(`modal-${name}`)?.classList.remove('active');
}

function showConfirm(title, msg, icon = '⚠️', okLabel = 'Confirmar', okClass = 'btn-danger') {
  setEl('conf-icon',  icon);
  setEl('conf-title', title);
  setEl('conf-msg',   msg);
  const btn = document.getElementById('conf-ok');
  if (btn) { btn.textContent = okLabel; btn.className = `btn ${okClass}`; btn.style.flex = '2'; }
  document.getElementById('modal-confirm')?.classList.add('active');
  return new Promise(res => { confirmResolve = res; });
}

function resolveConfirm(val) {
  document.getElementById('modal-confirm')?.classList.remove('active');
  if (confirmResolve) { confirmResolve(val); confirmResolve = null; }
}

// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && !e.target.id.includes('confirm')) {
    e.target.classList.remove('active');
  }
});

// ══════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════

function toast(msg, type = 'success', duration = 3000) {
  const icons = { success: '✓', error: '✕', info: '◆', warning: '⚠' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${icons[type]||'◆'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
}

// ══════════════════════════════════════════════════════════
//  RADIAL MENU
// ══════════════════════════════════════════════════════════

function setupRadial() {
  const fab     = document.getElementById('fab');
  const overlay = document.getElementById('radialOverlay');
  const hint    = document.getElementById('fabHint');
  const views   = ['overview','nubank','itau','btg','daytrade','dashboard'];
  const RADIUS  = 115;

  // Position items in semicircle (150° → 30°)
  views.forEach((v, i) => {
    const angleDeg = 150 - (120 / (views.length - 1)) * i;
    const rad = angleDeg * Math.PI / 180;
    const el  = document.getElementById(`ri-${v}`);
    if (el) {
      el.style.setProperty('--rx', Math.round(RADIUS * Math.cos(rad)) + 'px');
      el.style.setProperty('--ry', Math.round(-RADIUS * Math.sin(rad)) + 'px');
    }
  });

  let isOpen  = false;
  let active  = null;
  let dragged = false;

  // Each radial item: tap to navigate
  views.forEach(v => {
    const el = document.getElementById(`ri-${v}`);
    if (!el) return;
    el.addEventListener('touchend', e => {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) { switchView(v); closeMenu(); }
    }, { passive: false });
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (isOpen) { switchView(v); closeMenu(); }
    });
  });

  // ── TOUCH (iOS / Android) ──────────────────────────────
  // Tap FAB = toggle menu open/close
  // Drag from FAB while open = slide to item and release
  fab.addEventListener('touchstart', e => {
    e.preventDefault(); // prevents iOS scroll + context menu
    dragged = false;
    if (!isOpen) {
      openMenu();
    }
  }, { passive: false });

  fab.addEventListener('touchmove', e => {
    e.preventDefault();
    dragged = true;
    const t = e.touches[0];
    updateActive(t.clientX, t.clientY);
  }, { passive: false });

  fab.addEventListener('touchend', e => {
    e.preventDefault();
    if (dragged && active) {
      switchView(active);
      closeMenu();
    } else if (!dragged && isOpen) {
      // Tapped FAB while open = close
      closeMenu();
    }
    dragged = false;
  }, { passive: false });

  fab.addEventListener('touchcancel', () => { dragged = false; closeMenu(); }, { passive: true });

  // ── MOUSE (desktop) ───────────────────────────────────
  fab.addEventListener('mousedown', e => {
    e.preventDefault();
    dragged = false;
    if (!isOpen) openMenu();
  });

  document.addEventListener('mousemove', e => {
    if (!isOpen) return;
    dragged = true;
    updateActive(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    if (!isOpen) return;
    if (dragged && active) { switchView(active); closeMenu(); }
    else if (!dragged) { /* keep open — user just clicked FAB */ }
    dragged = false;
  });

  overlay.addEventListener('touchstart', () => closeMenu(), { passive: true });
  overlay.addEventListener('click', closeMenu);

  function updateActive(cx, cy) {
    const wrap = document.getElementById('fabWrap').getBoundingClientRect();
    const ox   = wrap.left + wrap.width  / 2;
    const oy   = wrap.top  + wrap.height / 2;
    const dist = Math.sqrt((cx - ox) ** 2 + (cy - oy) ** 2);

    let closest = null, minD = Infinity;
    if (dist > 28) {
      views.forEach(v => {
        const el = document.getElementById(`ri-${v}`);
        if (!el) return;
        const r  = el.getBoundingClientRect();
        const d  = Math.sqrt((cx - (r.left + r.width/2)) ** 2 + (cy - (r.top + r.height/2)) ** 2);
        if (d < minD) { minD = d; closest = v; }
      });
    }
    views.forEach(v => document.getElementById(`ri-${v}`)?.classList.remove('hi'));
    active = (closest && minD < 80) ? closest : null;
    if (active) document.getElementById(`ri-${active}`)?.classList.add('hi');
  }

  function openMenu() {
    isOpen = true;
    active = null;
    fab.classList.add('open');
    overlay.classList.add('active');
    views.forEach(v => document.getElementById(`ri-${v}`)?.classList.add('visible'));
    hint?.classList.add('gone');
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function closeMenu() {
    isOpen = false;
    active = null;
    dragged = false;
    fab.classList.remove('open');
    overlay.classList.remove('active');
    views.forEach(v => document.getElementById(`ri-${v}`)?.classList.remove('visible', 'hi'));
  }

  setTimeout(() => hint?.classList.add('gone'), 6000);
}

// ══════════════════════════════════════════════════════════
//  PIN / LOCK SYSTEM
// ══════════════════════════════════════════════════════════

async function hashPIN(pin) {
  if (!window.crypto?.subtle) return btoa(pin + '_simple');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + 'WealthPro_v6'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function showLock() {
  document.getElementById('lockScreen')?.classList.remove('hidden');
  document.getElementById('setupScreen')?.classList.add('hidden');
  document.getElementById('app')?.classList.add('hidden');
  const bioBtn = document.getElementById('bioBtn');
  const bioAvail = dados.security.bioEnabled && dados.security.bioCredId && window.isSecureContext && window.PublicKeyCredential;
  if (bioBtn) bioBtn.style.display = bioAvail ? 'flex' : 'none';
  pinBuffer = '';
  updatePinDots('pinDots', 0);
  setEl('lockError', '');
  // Auto-trigger Face ID / Touch ID on load
  if (bioAvail) setTimeout(doBiometric, 400);
}

function showSetup() {
  document.getElementById('lockScreen')?.classList.add('hidden');
  document.getElementById('setupScreen')?.classList.remove('hidden');
  document.getElementById('app')?.classList.add('hidden');
  setupBuffer = ''; setupFirst = ''; isSetupConfirm = false;
  setEl('setupStep', 'Criar PIN de acesso');
  setEl('setupSub', 'Digite 4 dígitos para proteger o app');
  updatePinDots('setupDots', 0);
  setEl('setupError', '');
}

function showApp() {
  document.getElementById('lockScreen')?.classList.add('hidden');
  document.getElementById('setupScreen')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  updateAll();
}

function updatePinDots(containerId, count, error = false) {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(containerId === 'pinDots' ? `d${i}` : `s${i}`);
    if (dot) {
      dot.className = 'pin-dot' + (i < count ? (error ? ' err' : ' filled') : '');
    }
  }
}

function pinKey(digit) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots('pinDots', pinBuffer.length);
  if (pinBuffer.length === 4) setTimeout(() => verifyPin(pinBuffer), 120);
}

function pinDel() {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots('pinDots', pinBuffer.length);
  setEl('lockError', '');
}

async function verifyPin(pin) {
  const hash = await hashPIN(pin);
  if (hash === dados.security.pinHash) {
    showApp();
  } else {
    updatePinDots('pinDots', 4, true);
    setEl('lockError', 'PIN incorreto');
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    setTimeout(() => { pinBuffer = ''; updatePinDots('pinDots', 0); setEl('lockError', ''); }, 900);
  }
}

// Registra credencial biométrica (chamado ao ativar nas Configurações)
async function registerBiometric() {
  if (!window.isSecureContext)       return toast('Face ID requer HTTPS — veja instruções nas Configurações', 'error', 4000);
  if (!window.PublicKeyCredential)   return toast('Seu dispositivo não suporta WebAuthn', 'error');
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Wealth Pro', id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: dados.usuario.nome || 'user',
        displayName: dados.usuario.nome || 'Wealth Pro'
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7  }, // ES256
        { type: 'public-key', alg: -257 } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // usa biometria do dispositivo (Face ID, Touch ID)
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000
    }});
    // Armazena ID da credencial (base64) para autenticação futura
    dados.security.bioCredId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    dados.security.bioEnabled = true;
    save();
    toast('Face ID / Touch ID ativado! 🔒', 'success');
    return true;
  } catch (e) {
    console.error('Registro biométrico falhou:', e);
    toast('Registro cancelado ou falhou', 'error');
    return false;
  }
}

// Autentica com Face ID / Touch ID
async function doBiometric() {
  if (!window.isSecureContext || !window.PublicKeyCredential) {
    setEl('lockError', 'Face ID requer HTTPS (veja Configurações)');
    return;
  }
  if (!dados.security.bioCredId) {
    setEl('lockError', 'Biometria não registrada — use o PIN');
    return;
  }
  try {
    setEl('lockError', '');
    const credIdBytes = Uint8Array.from(atob(dados.security.bioCredId), c => c.charCodeAt(0));
    await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: credIdBytes }],
      userVerification: 'required',
      timeout: 60000
    }});
    showApp(); // Face ID aprovado → entra no app
  } catch (e) {
    if (e.name !== 'NotAllowedError') { // NotAllowedError = usuário cancelou
      setEl('lockError', 'Biometria falhou — use o PIN');
    }
  }
}

function setupKey(digit) {
  if (setupBuffer.length >= 4) return;
  setupBuffer += digit;
  updatePinDots('setupDots', setupBuffer.length);
  if (setupBuffer.length === 4) setTimeout(() => handleSetup(setupBuffer), 120);
}

function setupDel() {
  setupBuffer = setupBuffer.slice(0, -1);
  updatePinDots('setupDots', setupBuffer.length);
}

async function handleSetup(pin) {
  if (!isSetupConfirm) {
    setupFirst = pin;
    isSetupConfirm = true;
    setupBuffer = '';
    setEl('setupStep', 'Confirmar PIN');
    setEl('setupSub', 'Digite os mesmos 4 dígitos novamente');
    updatePinDots('setupDots', 0);
  } else {
    if (pin === setupFirst) {
      dados.security.pinHash = await hashPIN(pin);
      dados.security.lockEnabled = true;
      save();
      showApp();
      toast('PIN criado com sucesso! 🔒');
    } else {
      updatePinDots('setupDots', 4, true);
      setEl('setupError', 'PINs não coincidem, tente novamente');
      setTimeout(() => {
        setupBuffer = ''; setupFirst = ''; isSetupConfirm = false;
        setEl('setupStep', 'Criar PIN de acesso');
        setEl('setupSub', 'Digite 4 dígitos para proteger o app');
        updatePinDots('setupDots', 0);
        setEl('setupError', '');
      }, 900);
    }
  }
}

function skipSetup() {
  dados.security.lockEnabled = false;
  dados.security.pinHash = 'skipped';
  save();
  showApp();
}

// ══════════════════════════════════════════════════════════
//  CHARTS
// ══════════════════════════════════════════════════════════

function initCharts() {
  Chart.defaults.color = '#555577';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';

  const defs = {
    evolucao:  { type: 'bar',      opts: { scales: barScales() } },
    categorias:{ type: 'doughnut', opts: { plugins: { legend: legendOpts() } } },
    compare:   { type: 'bar',      opts: { scales: barScales() } },
    carteira:  { type: 'doughnut', opts: { plugins: { legend: legendOpts() } } },
    dt:        { type: 'line',     opts: { scales: barScales() } }
  };

  Object.entries(defs).forEach(([id, d]) => {
    const ctx = document.getElementById(`chart-${id}`)?.getContext('2d');
    if (ctx) charts[id] = new Chart(ctx, { type: d.type, data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, ...d.opts } });
  });
}

function barScales() {
  return {
    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { family: 'Outfit', size: 10 } } },
    x: { grid: { display: false }, ticks: { font: { family: 'Outfit', size: 10, weight: '600' } } }
  };
}

function legendOpts() {
  return { display: true, position: 'bottom', labels: { color: '#7878a0', font: { family: 'Outfit', size: 11, weight: '600' }, padding: 12, boxWidth: 10 } };
}

function updateChart(id, data) {
  if (charts[id]) { charts[id].data = data; charts[id].update('none'); }
}

// ══════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}

function save() {
  try { localStorage.setItem('wealthPro_v6', JSON.stringify(dados)); return true; }
  catch (e) { console.error('Save error:', e); return false; }
}

function load() {
  try {
    // Try v6 first, then migrate from older versions
    const raw = localStorage.getItem('wealthPro_v6')
      || localStorage.getItem('wealthPro_v5')
      || localStorage.getItem('wealthPro_v4')
      || localStorage.getItem('wealthPro_backup');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.version === 6) {
      dados = mergeDeep(JSON.parse(JSON.stringify(DEFAULT)), parsed);
    } else {
      // Migrate from old schema (v4/v5)
      migrateOld(parsed);
    }
  } catch (e) { console.error('Load error:', e); }
}

function migrateOld(old) {
  // Preserve settings and security
  if (old.security) dados.security = { ...dados.security, ...old.security };
  if (old.usuario)  dados.usuario  = old.usuario;
  if (old.cdiAnual) dados.cdiAnual = old.cdiAnual;

  // Migrate cofrinhos
  if (old.cofrinhos) {
    ['nubank','itau','btg'].forEach(b => {
      if (old.cofrinhos[b]) dados.cofrinhos[b] = { ...dados.cofrinhos[b], ...old.cofrinhos[b] };
    });
  }

  // Migrate nubank
  if (old.nubank) {
    dados.nubank.limite = old.nubank.limite || 0;
    // Parcelas: old format had mesInicio (0-11 index), now anoMesInicio "YYYY-MM"
    (old.nubank.parcelas || []).forEach(p => {
      const yr = new Date().getFullYear();
      const anoMesInicio = `${yr}-${String((p.mesInicio||0)+1).padStart(2,'0')}`;
      dados.nubank.parcelas.push({ id: uid(), desc: p.descricao || p.desc || 'Parcela', valorParcela: p.valorParcela, numParcelas: p.numParcelas, anoMesInicio });
    });
    (old.nubank.gastosFixos || []).forEach(g => {
      const yr = new Date().getFullYear();
      const anoMesInicio = `${yr}-${String((g.mesInicio||0)+1).padStart(2,'0')}`;
      dados.nubank.assinaturas.push({ id: uid(), desc: g.descricao || g.desc, valor: g.valor, anoMesInicio });
    });
  }

  // Migrate itau
  if (old.itau) {
    dados.itau.saldo = old.itau.saldo || 0;
    (old.itau.receitas || []).forEach(r => {
      const ym_ = `${new Date().getFullYear()}-${String((r.mes||0)+1).padStart(2,'0')}`;
      dados.itau.transacoes.push({ id: uid(), tipo: 'r', desc: r.descricao || r.desc || 'Receita', cat: 'Outros', valor: r.valor, anoMes: ym_ });
    });
    (old.itau.gastos || []).forEach(g => {
      const ym_ = `${new Date().getFullYear()}-${String((g.mes||0)+1).padStart(2,'0')}`;
      dados.itau.transacoes.push({ id: uid(), tipo: 'd', desc: g.categoria || 'Despesa', cat: g.categoria || 'Outros', valor: g.valor, anoMes: ym_ });
    });
  }

  // Migrate BTG acoes
  if (old.btg?.acoes) {
    old.btg.acoes.forEach(a => {
      dados.btg.acoes.push({ id: uid(), ticker: a.ticker, qtd: a.quantidade, pm: a.precoMedio, preco: a.precoAtual, divMensal: a.dividendosMensal || 0, anoMesCompra: currentYM });
    });
  }

  // Migrate dayTrade
  if (old.dayTrade) {
    dados.dayTrade.saldoInicial = old.dayTrade.saldoInicial || 0;
    dados.dayTrade.saldoAtual   = old.dayTrade.saldoAtual   || 0;
    dados.dayTrade.custoContrato = old.dayTrade.custoContrato || 0.5;
    (old.dayTrade.operacoes || []).forEach(o => {
      const ym_ = `${new Date().getFullYear()}-${String((o.mes||0)+1).padStart(2,'0')}`;
      dados.dayTrade.operacoes.push({ id: uid(), data: o.data || new Date().toISOString().slice(0,10), tipo: o.tipo, valor: o.valor, contratos: o.contratos, custo: o.custoTotal || 0, liquido: o.valorLiquido || 0, obs: o.obs || '', anoMes: ym_ });
    });
  }

  // Migrate month summaries from old receitas/despesas arrays
  const yr = new Date().getFullYear();
  if (Array.isArray(old.receitas)) {
    old.receitas.forEach((v, i) => {
      if (v) getMes(`${yr}-${String(i+1).padStart(2,'0')}`).receitas = v;
    });
  }
  if (Array.isArray(old.despesas)) {
    old.despesas.forEach((v, i) => {
      if (v) getMes(`${yr}-${String(i+1).padStart(2,'0')}`).despesas = v;
    });
  }
  if (old.categorias) {
    const mes = getMes(currentYM);
    Object.entries(old.categorias).forEach(([k, v]) => { if (v > 0) mes.categorias[k] = (mes.categorias[k]||0) + v; });
  }

  dados.version = 6;
  save();
  toast('Dados migrados da versão anterior!', 'info', 4000);
}

// ══════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════

function fmt(val) {
  return 'R$ ' + (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setElClass(id, cls) { const el = document.getElementById(id); if (el) el.className = cls; }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }

function mergeDeep(target, source) {
  const out = { ...target };
  if (isObj(target) && isObj(source)) {
    Object.keys(source).forEach(k => {
      if (isObj(source[k]) && !Array.isArray(source[k])) {
        out[k] = k in target ? mergeDeep(target[k], source[k]) : source[k];
      } else {
        out[k] = source[k];
      }
    });
  }
  return out;
}

function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

// Autosave every 30s + on unload
setInterval(save, 30000);
window.addEventListener('beforeunload', save);

console.log('Wealth Pro v6 ◆');
