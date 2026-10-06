import { pathToFileURL } from "node:url";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "baileys";
//#region src/logic/tempo.ts
var MINUTOS_DIA = 1440;
var HORA_MS = 36e5;
var DIA_MS = 24 * HORA_MS;
/** 00:00 local do dia de `ms`. */
function inicioDoDiaLocal(ms) {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}
/** Minutos desde a 00:00 local. */
function minutoDoDia(ms) {
	const d = new Date(ms);
	return d.getHours() * 60 + d.getMinutes();
}
/** Fatia de 10 min do dia local, 0–143. */
function fatiaDoDia(ms) {
	return Math.floor(minutoDoDia(ms) / 10);
}
/** 'AAAA-MM-DD' do dia local — chave de cache e de "já avisado hoje". */
function chaveData(ms) {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** 'HH:MM' de um minuto do dia; aceita valores além de 1440 (dia seguinte). */
function rotuloHora(minuto) {
	const m = (Math.round(minuto) % MINUTOS_DIA + MINUTOS_DIA) % MINUTOS_DIA;
	return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** 'HH:MM' local de um instante. */
function horaDe(ms) {
	return rotuloHora(minutoDoDia(ms));
}
3 * HORA_MS;
/** Em quantos dias distintos cada fatia de 10 min teve cintilação ≥ média. */
function contarDiasPorFatia(historico) {
	const dias = Array.from({ length: 144 }, () => /* @__PURE__ */ new Set());
	for (const p of historico) {
		if (p.previsto || p.cintilacao == null || p.cintilacao < 33) continue;
		dias[fatiaDoDia(p.instante)].add(chaveData(p.instante));
	}
	return dias.map((s) => s.size);
}
/** Fatias com risco em ≥ `minimoDias` dias, juntas em janelas — inclusive
*  através da meia-noite (a noite é justamente quando a cintilação acontece).
*  Buracos de até `toleranciaMin` entre duas janelas não as separam. */
function janelasDeRisco(contagem, minimoDias = 3, toleranciaMin = 30) {
	const contiguas = [];
	let atual = null;
	for (let f = 0; f < contagem.length; f++) if (contagem[f] >= minimoDias) {
		if (atual) {
			atual.fim = (f + 1) * 10;
			atual.dias = Math.max(atual.dias, contagem[f]);
		} else atual = {
			inicio: f * 10,
			fim: (f + 1) * 10,
			dias: contagem[f]
		};
	} else if (atual) {
		contiguas.push(atual);
		atual = null;
	}
	if (atual) contiguas.push(atual);
	const janelas = [];
	for (const proxima of contiguas) {
		const anterior = janelas[janelas.length - 1];
		if (anterior && proxima.inicio - anterior.fim <= toleranciaMin) {
			anterior.fim = proxima.fim;
			anterior.dias = Math.max(anterior.dias, proxima.dias);
		} else janelas.push(proxima);
	}
	if (janelas.length > 1) {
		const primeira = janelas[0];
		const ultima = janelas[janelas.length - 1];
		if (primeira.inicio + 1440 - ultima.fim <= toleranciaMin) {
			ultima.fim = MINUTOS_DIA + primeira.fim;
			ultima.dias = Math.max(ultima.dias, primeira.dias);
			janelas.shift();
		}
	}
	return janelas;
}
function textoJanela(j) {
	return `${rotuloHora(j.inicio)}–${rotuloHora(j.fim)} (${j.dias} de 7 dias)`;
}
/** A janela ainda tem algum pedaço por vir hoje (a partir de `minutoAgora`). */
function janelaAindaPorVir(j, minutoAgora) {
	return j.fim > minutoAgora;
}
//#endregion
//#region src/logic/alertas.ts
function listarFazendas(nomes) {
	const n = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
	if (n.length === 1) return n[0];
	const resto = n.length > 3 ? ` e mais ${n.length - 3}` : "";
	return `${n.length} fazendas: ${n.slice(0, 3).join(", ")}${resto}`;
}
function chaveGrupo(o) {
	if (o.tipo === "janela") return o.momento === "antes" ? `janela:antes:${o.janela?.inicio}:${o.janela?.fim}` : "janela:dia";
	return `${o.tipo}:${o.severidade}`;
}
function textoGrupo(grupo, nomes) {
	const o = grupo[0];
	const onde = listarFazendas(nomes);
	const pico = Math.max(...grupo.map((x) => x.valor));
	if (o.tipo === "cintilacao") return `Cintilação ${o.severidade === "critico" ? "forte" : "média"} agora em ${onde} (até ${Math.round(pico)} de 100).`;
	if (o.tipo === "previsao") return `Previsão: índice ionosférico ${pico} a partir de ${horaDe(Math.min(...grupo.map((x) => x.instante)))} em ${onde}.`;
	if (o.momento !== "antes") {
		const inicio = Math.min(...grupo.map((x) => x.janela?.inicio ?? 0));
		const fim = Math.max(...grupo.map((x) => x.janela?.fim ?? 0));
		const pior = grupo.reduce((a, b) => (b.janela?.dias ?? 0) > (a.janela?.dias ?? 0) ? b : a);
		return `Janelas de risco de cintilação hoje entre ${rotuloHora(inicio)} e ${rotuloHora(fim)} em ${onde}. Pior horário: ${pior.janela ? textoJanela(pior.janela) : ""}.`;
	}
	return `Janela de risco de cintilação começa em breve: ${o.janela ? textoJanela(o.janela) : ""} em ${onde}.`;
}
var ORDEM_SEVERIDADE = {
	critico: 0,
	aviso: 1
};
function montarAlertas(ocorrencias, fazendasPorCelula, agora) {
	const grupos = /* @__PURE__ */ new Map();
	for (const o of ocorrencias) {
		const k = chaveGrupo(o);
		grupos.set(k, [...grupos.get(k) ?? [], o]);
	}
	const alertas = [];
	for (const [k, grupo] of grupos) {
		const nomes = [...new Set(grupo.flatMap((o) => fazendasPorCelula[o.celulaId] ?? []))].sort((a, b) => a.localeCompare(b, "pt-BR"));
		if (!nomes.length) continue;
		alertas.push({
			id: `${agora}:${k}`,
			instante: agora,
			tipo: grupo[0].tipo,
			severidade: grupo[0].severidade,
			fazendas: nomes,
			texto: textoGrupo(grupo, nomes)
		});
	}
	return alertas.sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade]);
}
//#endregion
//#region src/fazendasGnss.ts
function celulaDe(lat, lon) {
	const la = Math.round(lat * 2) / 2;
	const lo = Math.round(lon * 2) / 2;
	return {
		id: `${la}_${lo}`,
		lat: la,
		lon: lo
	};
}
//#endregion
//#region src/logic/limites.ts
function geometriaValida(g) {
	if (typeof g !== "object" || g === null) return false;
	const { type, coordinates } = g;
	return (type === "Polygon" || type === "MultiPolygon") && Array.isArray(coordinates);
}
/** Talhões agrupados por fazenda; linha sem polígono fica de fora, fazenda sem nenhum não aparece. */
function limitesPorFazenda(linhas) {
	const limites = {};
	for (const { fazenda_id, geom } of linhas) {
		if (!geometriaValida(geom)) continue;
		limites[fazenda_id] ??= {
			type: "FeatureCollection",
			features: []
		};
		limites[fazenda_id].features.push({
			type: "Feature",
			properties: {},
			geometry: geom
		});
	}
	return limites;
}
/** Meio da caixa que envolve todos os talhões; `null` sem nenhum vértice válido. */
function centroDoLimite(limite) {
	let oeste = Infinity;
	let leste = -Infinity;
	let sul = Infinity;
	let norte = -Infinity;
	const andar = (c) => {
		if (!Array.isArray(c)) return;
		if (typeof c[0] === "number" && typeof c[1] === "number") {
			if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
			oeste = Math.min(oeste, c[0]);
			leste = Math.max(leste, c[0]);
			sul = Math.min(sul, c[1]);
			norte = Math.max(norte, c[1]);
			return;
		}
		for (const filho of c) andar(filho);
	};
	for (const f of limite.features) andar(f.geometry.coordinates);
	if (!Number.isFinite(oeste) || !Number.isFinite(sul)) return null;
	return {
		lat: (sul + norte) / 2,
		lon: (oeste + leste) / 2
	};
}
//#endregion
//#region src/servidor/banco.ts
/**
* Acesso do serviço da VM ao Supabase, direto pela API REST e com a chave de serviço
* (ela passa por cima das regras de linha; por isso nunca entra em mensagem de erro).
*/
var PAGINA = 1e3;
var PRAZO_MS$1 = 2e4;
var GUARDA_ENVIOS_DIAS = 30;
function criarBanco(opcoes) {
	const buscar = opcoes.fetch ?? globalThis.fetch;
	const agora = opcoes.agora ?? Date.now;
	const base = `${opcoes.url.replace(/\/+$/, "")}/rest/v1`;
	const agoraIso = () => new Date(agora()).toISOString();
	async function pedir(acao, caminho, pedido = {}) {
		const headers = {
			apikey: opcoes.chave,
			Authorization: `Bearer ${opcoes.chave}`,
			...pedido.headers
		};
		if (pedido.body !== void 0) headers["Content-Type"] = "application/json";
		const resposta = await buscar(`${base}/${caminho}`, {
			method: pedido.method ?? "GET",
			headers,
			body: pedido.body === void 0 ? void 0 : JSON.stringify(pedido.body),
			signal: AbortSignal.timeout(PRAZO_MS$1)
		});
		if (resposta.ok || pedido.aceitar?.includes(resposta.status)) return resposta;
		let detalhe = "";
		try {
			detalhe = await resposta.text();
		} catch {}
		if (opcoes.chave) detalhe = detalhe.replaceAll(opcoes.chave, "***");
		throw new Error(`Supabase recusou ${acao} (HTTP ${resposta.status})${detalhe ? `: ${detalhe.slice(0, 200)}` : ""}`);
	}
	async function lerTudo(acao, tabela, consulta) {
		const todas = [];
		for (let de = 0;; de += PAGINA) {
			const resposta = await pedir(acao, `${tabela}?${consulta}`, { headers: {
				"Range-Unit": "items",
				Range: `${de}-${de + PAGINA - 1}`
			} });
			let linhas;
			try {
				linhas = await resposta.json();
			} catch {
				throw new Error("Supabase devolveu resposta fora do formato");
			}
			todas.push(...linhas);
			if (linhas.length < PAGINA) return todas;
		}
	}
	const alterar = (acao, caminho, corpo) => pedir(acao, caminho, {
		method: "PATCH",
		body: corpo,
		headers: { Prefer: "return=minimal" }
	}).then(() => void 0);
	return {
		async contatos() {
			const linhas = await lerTudo("ler os contatos", "whatsapp_contatos", "select=*&order=nome");
			const ligacoes = await lerTudo("ler as fazendas dos contatos", "whatsapp_contato_fazendas", "select=*&order=contato_id,fazenda_id");
			const porContato = /* @__PURE__ */ new Map();
			for (const l of ligacoes) porContato.set(l.contato_id, [...porContato.get(l.contato_id) ?? [], Number(l.fazenda_id)]);
			return linhas.map((l) => ({
				id: l.id,
				nome: l.nome,
				telefone: l.telefone,
				todasFazendas: l.todas_fazendas,
				fazendas: porContato.get(l.id) ?? [],
				alertaJanela: l.alerta_janela,
				ativo: l.ativo,
				confirmadoEm: l.confirmado_em ?? null,
				confirmadoPor: l.confirmado_por ?? null,
				jid: l.jid ?? null
			}));
		},
		async fazendas() {
			const linhas = await lerTudo("ler as fazendas", "mapas_fazendas", "select=id,nome,coa_fazenda_id&order=nome,id");
			const limites = limitesPorFazenda(await lerTudo("ler os talhões", "mapas_talhoes", "select=fazenda_id,geom&order=id"));
			return linhas.map((l) => {
				const centro = limites[l.id] ? centroDoLimite(limites[l.id]) : null;
				const celula = centro ? celulaDe(centro.lat, centro.lon) : null;
				return {
					id: l.id,
					coaId: l.coa_fazenda_id == null ? null : Number(l.coa_fazenda_id),
					nome: l.nome,
					celulaId: celula?.id ?? null,
					lat: celula?.lat ?? null,
					lon: celula?.lon ?? null
				};
			});
		},
		async reservarEnvio(contatoId, chave, tipo) {
			return (await pedir("reservar o envio", "whatsapp_envios", {
				method: "POST",
				body: {
					contato_id: contatoId,
					chave,
					tipo,
					situacao: "enviando"
				},
				headers: { Prefer: "return=minimal" },
				aceitar: [409]
			})).status !== 409;
		},
		fecharEnvio(contatoId, chave, situacao, erro) {
			return alterar("fechar o envio", `whatsapp_envios?contato_id=eq.${encodeURIComponent(contatoId)}&chave=eq.${encodeURIComponent(chave)}`, {
				situacao,
				enviado_em: situacao === "enviado" ? agoraIso() : null,
				erro: erro ? erro.slice(0, 300) : null
			});
		},
		async chavesDoDia(dia) {
			return (await lerTudo("ler os envios do dia", "whatsapp_envios", `select=contato_id,chave&chave=like.${encodeURIComponent(dia)}:*&order=contato_id,chave`)).map((l) => ({
				contatoId: l.contato_id,
				chave: l.chave
			}));
		},
		confirmar(contatoId, jid) {
			const agoraStr = agoraIso();
			return alterar("confirmar o contato", `whatsapp_contatos?id=eq.${encodeURIComponent(contatoId)}`, {
				confirmado_em: agoraStr,
				confirmado_por: "mensagem",
				jid,
				ativo: true,
				atualizado_em: agoraStr
			});
		},
		guardarJid(contatoId, jid) {
			return alterar("guardar o endereço do contato", `whatsapp_contatos?id=eq.${encodeURIComponent(contatoId)}`, {
				jid,
				atualizado_em: agoraIso()
			});
		},
		pausar(contatoId) {
			return alterar("pausar o contato", `whatsapp_contatos?id=eq.${encodeURIComponent(contatoId)}`, {
				ativo: false,
				atualizado_em: agoraIso()
			});
		},
		gravarEstado(estado) {
			const corpo = {
				conectado: estado.conectado,
				batimento_em: agoraIso()
			};
			if (estado.desde !== void 0) corpo.desde = estado.desde;
			if (estado.ultimoEnvioEm !== void 0) corpo.ultimo_envio_em = estado.ultimoEnvioEm;
			if (estado.ultimoErro !== void 0) corpo.ultimo_erro = estado.ultimoErro === null ? null : estado.ultimoErro.slice(0, 300);
			return alterar("gravar o estado do serviço", "whatsapp_estado?id=eq.1", corpo);
		},
		async limparEnviosAntigos() {
			const limite = (/* @__PURE__ */ new Date(agora() - GUARDA_ENVIOS_DIAS * DIA_MS)).toISOString();
			await pedir("limpar os envios antigos", `whatsapp_envios?criado_em=lt.${encodeURIComponent(limite)}`, {
				method: "DELETE",
				headers: { Prefer: "return=minimal" }
			});
		}
	};
}
//#endregion
//#region src/servidor/comandos.ts
function lerComando(texto) {
	const limpo = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, " ").trim();
	if (limpo === "ativar") return "ativar";
	if (limpo === "sair" || limpo === "parar") return "sair";
	return null;
}
/** DDD + 8 últimos dígitos. O WhatsApp guarda alguns números brasileiros sem o nono dígito. */
function chaveDoNumero(telefoneOuJid) {
	const [usuario, servidor] = telefoneOuJid.split("@");
	if (servidor !== void 0 && servidor !== "s.whatsapp.net") return null;
	const d = usuario.split(":")[0].replace(/\D/g, "");
	const m = /^55([1-9][1-9])9?(\d{8})$/.exec(d);
	return m ? m[1] + m[2] : null;
}
function mesmoNumero(a, b) {
	const ka = chaveDoNumero(a);
	return ka !== null && ka === chaveDoNumero(b);
}
/** Para os registros: nunca o número inteiro. */
function mascarar(telefone) {
	return `…${telefone.replace(/\D/g, "").slice(-4)}`;
}
/** 00:05, 07:00 e 12:00: três consultas por quadrado por dia à Trimble. */
var MINUTOS_DE_CALCULO = [
	5,
	420,
	720
];
function chaveEvento(agora, tipo) {
	return `${chaveData(agora)}:${tipo}`;
}
function eventosFixosNaHora(agora) {
	const m = minutoDoDia(agora);
	const naHora = (inicio) => m >= inicio && m <= inicio + 60;
	const eventos = [];
	if (naHora(420)) eventos.push("resumo-07");
	if (naHora(720)) eventos.push("lembrete-12");
	return eventos;
}
/** Já passou de algum horário de cálculo desde o último? (`null` = nunca calculou.) */
function precisaCalcular(agora, calculadoEm) {
	if (calculadoEm == null) return true;
	const dia = inicioDoDiaLocal(agora);
	return [dia - DIA_MS + MINUTOS_DE_CALCULO[MINUTOS_DE_CALCULO.length - 1] * 6e4, ...MINUTOS_DE_CALCULO.map((m) => dia + m * 6e4)].some((marco) => marco <= agora && marco > calculadoEm);
}
/** A janela que começa primeiro dentro dos próximos 30 min (ou agora); `null` se nenhuma. */
function janelaDoAntes(janelas, agora) {
	const m = minutoDoDia(agora);
	const perto = janelas.filter((j) => j.inicio - m >= 0 && j.inicio - m <= 30);
	return perto.length ? perto.reduce((a, b) => b.inicio < a.inicio ? b : a) : null;
}
//#endregion
//#region src/servidor/mensagens.ts
/**
* O que cada pessoa lê. O texto do resumo e do "começa em breve" sai de `montarAlertas`, o mesmo
* da tela, com as fazendas da pessoa; o lembrete do meio-dia tem outras palavras de propósito
* (duas mensagens iguais no mesmo dia parecem robô para o WhatsApp).
*/
var TITULO = "*Locks SAT · Janela de risco*";
function fazendasDoContato(contato, fazendas) {
	return fazendas.filter((f) => f.celulaId && (contato.todasFazendas || f.coaId != null && contato.fazendas.includes(f.coaId)));
}
function textoDoEvento(tipo, contato, fazendas, porCelula, agora) {
	const minhas = fazendasDoContato(contato, fazendas);
	const minuto = minutoDoDia(agora);
	const nomesPorCelula = {};
	for (const f of minhas) (nomesPorCelula[f.celulaId] ??= []).push(f.nome);
	const celulas = Object.keys(nomesPorCelula);
	const base = {
		tipo: "janela",
		severidade: "aviso",
		instante: agora
	};
	if (tipo === "antes") {
		const primeira = janelaDoAntes(celulas.flatMap((c) => porCelula[c] ?? []), agora);
		if (!primeira) return null;
		return montarAlertas(celulas.filter((c) => (porCelula[c] ?? []).some((j) => j.inicio === primeira.inicio && j.fim === primeira.fim)).map((c) => ({
			...base,
			celulaId: c,
			valor: primeira.dias,
			janela: primeira,
			momento: "antes"
		})), nomesPorCelula, agora)[0]?.texto ?? null;
	}
	const ocorrencias = celulas.flatMap((c) => (porCelula[c] ?? []).filter((j) => janelaAindaPorVir(j, minuto)).map((j) => ({
		...base,
		celulaId: c,
		valor: j.dias,
		janela: j,
		momento: "dia"
	})));
	if (!ocorrencias.length) return null;
	if (tipo === "resumo-07") return montarAlertas(ocorrencias, nomesPorCelula, agora)[0]?.texto ?? null;
	const inicio = Math.min(...ocorrencias.map((o) => o.janela?.inicio ?? 0));
	const nomes = [...new Set(ocorrencias.flatMap((o) => nomesPorCelula[o.celulaId]))];
	return `Lembrete: janela de risco de cintilação hoje a partir de ${rotuloHora(inicio)} em ${listarFazendas(nomes)}.`;
}
function primeiroNome(contato) {
	return contato.nome.trim().split(/\s+/)[0];
}
function saudacao(agora) {
	const h = new Date(agora).getHours();
	return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function montarMensagem(contato, texto, agora, comSair) {
	const linhas = [
		TITULO,
		`${saudacao(agora)}, ${primeiroNome(contato)}.`,
		texto
	];
	if (comSair) linhas.push("Para parar de receber, responda SAIR.");
	return linhas.join("\n");
}
function textoAtivado(contato, nomesFazendas) {
	const onde = nomesFazendas.length ? [...nomesFazendas].sort((a, b) => a.localeCompare(b, "pt-BR")).join(", ") : "suas fazendas";
	return `Pronto, ${primeiroNome(contato)}. Você vai receber aqui os alertas de janela de risco do Locks SAT de: ${onde}. Para parar, responda SAIR.`;
}
function textoSaiu(contato) {
	return `Certo, ${primeiroNome(contato)}. Você não vai mais receber os alertas. Para voltar, mande ATIVAR.`;
}
var entre = (min, max, sorteio) => Math.floor(min + sorteio() * (max - min));
function pausaEntrePessoas(sorteio = Math.random) {
	return entre(2e4, 45e3, sorteio);
}
function tempoDigitando(sorteio = Math.random) {
	return entre(2e3, 4e3, sorteio);
}
var ContadorDoDia = class {
	dia = "";
	porContato = /* @__PURE__ */ new Map();
	soma = 0;
	agora;
	constructor(agora) {
		this.agora = agora;
	}
	virar() {
		const hoje = chaveData(this.agora());
		if (hoje === this.dia) return;
		this.dia = hoje;
		this.porContato.clear();
		this.soma = 0;
	}
	/** Pode mandar mais uma mensagem qualquer hoje (teto do dia)? */
	podeMensagem() {
		this.virar();
		return this.soma < 80;
	}
	/** Pode mandar mais um ALERTA para este contato hoje? */
	podeAlerta(contatoId) {
		return this.podeMensagem() && (this.porContato.get(contatoId) ?? 0) < 3;
	}
	/** `null` = resposta de ATIVAR/SAIR. */
	contar(contatoId) {
		this.virar();
		this.soma += 1;
		if (contatoId) this.porContato.set(contatoId, (this.porContato.get(contatoId) ?? 0) + 1);
	}
	get total() {
		this.virar();
		return this.soma;
	}
};
//#endregion
//#region src/api/gnssApi.ts
var ErroGnss = class extends Error {
	tipo;
	status;
	constructor(tipo, status, mensagem) {
		super(mensagem);
		this.name = "ErroGnss";
		this.tipo = tipo;
		this.status = status;
	}
};
/** 'AAAA-MM-DDTHH:MM:SS' em UTC, sem o 'Z' — o formato que a Trimble aceita. */
function isoTrimble(ms) {
	return new Date(ms).toISOString().slice(0, 19);
}
function numeroOuNull(v) {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function converterItem(item) {
	return {
		instante: Date.parse(item.timeOfEstimation),
		indice: numeroOuNull(item.value) ?? 0,
		tec: numeroOuNull(item.tecValue) ?? 0,
		cintilacao: item.predicted ? null : numeroOuNull(item.scintiValue),
		previsto: Boolean(item.predicted)
	};
}
/** A lista da Trimble já em `PontoIono`; resposta fora do formato vira erro. */
function converterSerieTrimble(dados) {
	if (!Array.isArray(dados)) throw new ErroGnss("indisponivel", 200, "Resposta da Trimble fora do formato esperado.");
	return dados.map(converterItem).filter((p) => Number.isFinite(p.instante));
}
//#endregion
//#region src/servidor/trimble.ts
/**
* A VM fala direto com a Trimble (a ponte do COA WEB só atende quem está logado no site).
* São três consultas por quadrado por dia; a Trimble recusa quem não parece navegador.
*/
var BASE = "https://www.gnssplanning.com/api";
var NAVEGADOR = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var PRAZO_MS = 3e4;
function criarTrimble(opcoes = {}) {
	const buscar = opcoes.fetch ?? globalThis.fetch;
	return { 
	/** Os 7 dias inteiros antes de hoje, como o vigia da tela. */
async historico(celula, agora) {
		const inicio = inicioDoDiaLocal(agora) - 7 * DIA_MS;
		const url = `${BASE}/ionoindex/${celula.lon}/${celula.lat}/${isoTrimble(inicio)}/168/600`;
		let resposta;
		try {
			resposta = await buscar(url, {
				headers: {
					"User-Agent": NAVEGADOR,
					Accept: "application/json"
				},
				signal: AbortSignal.timeout(PRAZO_MS),
				redirect: "error"
			});
		} catch {
			throw new ErroGnss("rede", 0, "Sem resposta da Trimble.");
		}
		if (resposta.status === 403 || resposta.status === 429) throw new ErroGnss("bloqueio", resposta.status, "A Trimble recusou a consulta.");
		if (!resposta.ok) throw new ErroGnss("indisponivel", resposta.status, `A Trimble respondeu ${resposta.status}.`);
		let dados;
		try {
			dados = await resposta.json();
		} catch {
			throw new ErroGnss("indisponivel", resposta.status, "Resposta da Trimble fora do formato esperado.");
		}
		const serie = converterSerieTrimble(dados);
		if (serie.length === 0) throw new ErroGnss("indisponivel", 200, "A Trimble devolveu série vazia.");
		return serie;
	} };
}
function janelasDeHoje(historico) {
	return janelasDeRisco(contarDiasPorFatia(historico));
}
//#endregion
//#region src/servidor/servico.ts
/**
* O laço do serviço: a cada minuto decide o que mandar e a quem. É aqui que uma mensagem sai (ou
* não) para uma pessoa, então a ordem das coisas importa: o envio é reservado no banco ANTES de
* mandar, e se a reserva não vale (já existia, ou o banco falhou) a mensagem não sai.
*/
var BATIMENTO_MS = 3e5;
/** A Trimble recusa quem insiste: depois de uma falha, só tenta de novo passado este tempo. */
var NOVA_TENTATIVA_TRIMBLE_MS = 3e5;
var PAUSA_ENTRE_QUADRADOS_MS = 2e3;
/** 00:05: a primeira volta depois disso, a cada dia, apaga os envios antigos. */
var MINUTO_DA_LIMPEZA = MINUTOS_DE_CALCULO[0];
var ERRO_TETO_DO_DIA = "teto diário de mensagens atingido";
var ERRO_SEM_WHATSAPP = "número sem WhatsApp";
var mensagemDe$1 = (e) => e instanceof Error ? e.message : String(e);
/** Os dígitos do número que vem num endereço do WhatsApp (sem servidor nem aparelho). */
var numeroDoJid = (jid) => jid.split("@")[0].split(":")[0];
var Servico = class {
	d;
	contador;
	janelas = null;
	falhaDoCalculoEm = null;
	ultimoBatimento = null;
	diaDaLimpeza = "";
	diaDoAvisoDeTeto = "";
	emVolta = false;
	/** Quem mandou SAIR enquanto uma volta rodava: a lista de contatos dela já estava lida. */
	pausados = /* @__PURE__ */ new Set();
	/** Só no ensaio: o que já foi registrado, para não repetir a cada minuto. */
	ensaiados = /* @__PURE__ */ new Set();
	constructor(d) {
		this.d = d;
		this.contador = new ContadorDoDia(d.agora);
	}
	/** Uma volta do laço: calcula se precisa, manda o que está na hora, grava o batimento a cada 5 min. */
	async volta() {
		if (this.emVolta) return;
		this.emVolta = true;
		try {
			const agora = this.d.agora();
			await this.bater(agora);
			await this.limparUmaVezPorDia(agora);
			await this.calcularSePreciso(agora);
			if (!this.janelas) return;
			if (!this.d.ensaio && !this.d.whatsapp.conectado) return;
			const tipos = [...eventosFixosNaHora(agora), "antes"];
			if (!this.algoNaHora(agora, this.janelas)) return;
			await this.enviarEventos(agora, tipos, this.janelas);
		} catch (e) {
			this.d.registrar(`falha na volta: ${mensagemDe$1(e)}`);
		} finally {
			this.emVolta = false;
		}
	}
	/** Mensagem recebida de alguém: ATIVAR ou SAIR de contato cadastrado. */
	async recebida(m) {
		const comando = lerComando(m.texto);
		if (!comando) return;
		const quem = mascarar(numeroDoJid(m.jid));
		if (this.d.ensaio) {
			this.d.registrar(`ensaio: comando de ${quem} ignorado`);
			return;
		}
		try {
			const contato = (await this.d.banco.contatos()).find((c) => mesmoNumero(c.telefone, m.jid));
			if (!contato) {
				this.d.registrar(`comando de número não cadastrado (${quem}) ignorado`);
				return;
			}
			let resposta;
			if (comando === "ativar") {
				await this.d.banco.confirmar(contato.id, m.jid);
				this.pausados.delete(contato.id);
				let nomes = [];
				try {
					nomes = [...new Set(fazendasDoContato(contato, await this.d.banco.fazendas()).map((f) => f.nome))];
				} catch (e) {
					this.d.registrar(`${quem}: não li as fazendas para a resposta: ${mensagemDe$1(e)}`);
				}
				resposta = textoAtivado(contato, nomes);
				this.d.registrar(`ativado: ${mascarar(contato.telefone)}`);
			} else {
				this.pausados.add(contato.id);
				await this.d.banco.pausar(contato.id);
				resposta = textoSaiu(contato);
				this.d.registrar(`pausado: ${mascarar(contato.telefone)}`);
			}
			await this.responder(m.jid, quem, resposta);
		} catch (e) {
			this.d.registrar(`falha ao tratar mensagem de ${quem}: ${mensagemDe$1(e)}`);
		}
	}
	/** Estado da conexão mudou. */
	async conexao(conectado, motivo) {
		this.d.registrar(`WhatsApp ${conectado ? "conectado" : "desconectado"}${motivo ? `: ${motivo}` : ""}`);
		if (this.d.ensaio) return;
		try {
			await this.d.banco.gravarEstado({
				conectado,
				desde: new Date(this.d.agora()).toISOString(),
				ultimoErro: conectado ? null : motivo ?? null
			});
		} catch (e) {
			this.d.registrar(`não gravei o estado da conexão: ${mensagemDe$1(e)}`);
		}
	}
	async bater(agora) {
		if (this.d.ensaio) return;
		if (this.ultimoBatimento !== null && agora - this.ultimoBatimento < BATIMENTO_MS) return;
		try {
			await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado });
			this.ultimoBatimento = agora;
		} catch (e) {
			this.d.registrar(`não gravei o batimento: ${mensagemDe$1(e)}`);
		}
	}
	async limparUmaVezPorDia(agora) {
		const dia = chaveData(agora);
		if (this.d.ensaio || this.diaDaLimpeza === dia || minutoDoDia(agora) < MINUTO_DA_LIMPEZA) return;
		this.diaDaLimpeza = dia;
		try {
			await this.d.banco.limparEnviosAntigos();
		} catch (e) {
			this.d.registrar(`não limpei os envios antigos: ${mensagemDe$1(e)}`);
		}
	}
	async calcularSePreciso(agora) {
		if (!precisaCalcular(agora, this.janelas?.calculadoEm ?? null)) return;
		if (this.falhaDoCalculoEm !== null && agora - this.falhaDoCalculoEm < NOVA_TENTATIVA_TRIMBLE_MS) return;
		const fazendas = await this.d.banco.fazendas();
		const quadrados = /* @__PURE__ */ new Map();
		for (const f of fazendas) if (f.celulaId && f.lat != null && f.lon != null) quadrados.set(f.celulaId, {
			lat: f.lat,
			lon: f.lon
		});
		const porCelula = {};
		try {
			let primeiro = true;
			for (const [id, celula] of quadrados) {
				if (!primeiro) await this.d.dormir(PAUSA_ENTRE_QUADRADOS_MS);
				primeiro = false;
				porCelula[id] = janelasDeHoje(await this.d.trimble.historico(celula, agora));
			}
		} catch (e) {
			this.falhaDoCalculoEm = agora;
			this.d.registrar(`Trimble: ${mensagemDe$1(e)}`);
			return;
		}
		this.janelas = {
			calculadoEm: agora,
			porCelula
		};
		this.falhaDoCalculoEm = null;
		this.d.registrar(`janelas calculadas para ${quadrados.size} quadrado(s)`);
	}
	/** Evita ler contatos e fazendas (o banco) a cada minuto do dia: só quando há um evento a considerar. */
	algoNaHora(agora, janelas) {
		if (eventosFixosNaHora(agora).length) return true;
		return Object.values(janelas.porCelula).some((js) => janelaDoAntes(js, agora) !== null);
	}
	async enviarEventos(agora, tipos, janelas) {
		this.pausados.clear();
		const [contatos, fazendas, jaReservadas] = await Promise.all([
			this.d.banco.contatos(),
			this.d.banco.fazendas(),
			this.d.banco.chavesDoDia(chaveData(agora))
		]);
		const aptos = contatos.filter((c) => c.ativo && c.alertaJanela && c.confirmadoEm).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
		let tentouAlgum = false;
		for (const tipo of tipos) {
			const chave = chaveEvento(agora, tipo);
			for (const contato of aptos) {
				if (jaReservadas.some((r) => r.contatoId === contato.id && r.chave === chave)) continue;
				let pronto = await this.preparar(tipo, contato, fazendas, janelas);
				if (pronto === "parar") return;
				if (pronto === null) continue;
				if (tentouAlgum && !this.d.ensaio) {
					await this.d.dormir(pausaEntrePessoas());
					pronto = await this.preparar(tipo, contato, fazendas, janelas);
					if (pronto === "parar") return;
					if (pronto === null) continue;
				}
				if (this.d.ensaio) this.ensaiar(contato, tipo, chave, pronto, jaReservadas);
				else if (await this.mandar(contato, tipo, chave, pronto, jaReservadas)) tentouAlgum = true;
			}
		}
	}
	/** O texto a mandar a este contato agora; `null` = nada para ele; `'parar'` = nada mais sai nesta volta. */
	async preparar(tipo, contato, fazendas, janelas) {
		if (!this.d.ensaio && !this.d.whatsapp.conectado) return "parar";
		if (this.pausados.has(contato.id)) return null;
		const texto = textoDoEvento(tipo, contato, fazendas, janelas.porCelula, this.d.agora());
		if (!texto) return null;
		if (this.contador.podeAlerta(contato.id)) return texto;
		if (this.contador.podeMensagem()) return null;
		await this.avisarTetoDoDia();
		return "parar";
	}
	async avisarTetoDoDia() {
		const dia = chaveData(this.d.agora());
		if (this.diaDoAvisoDeTeto === dia) return;
		this.diaDoAvisoDeTeto = dia;
		this.d.registrar(`${ERRO_TETO_DO_DIA}: nada mais sai hoje`);
		if (this.d.ensaio) return;
		try {
			await this.d.banco.gravarEstado({
				conectado: this.d.whatsapp.conectado,
				ultimoErro: ERRO_TETO_DO_DIA
			});
		} catch (e) {
			this.d.registrar(`não gravei o aviso de teto: ${mensagemDe$1(e)}`);
		}
	}
	/** `true` se tentou mandar (deu certo ou não): é o que pede a pausa antes da próxima pessoa. */
	async mandar(contato, tipo, chave, texto, jaReservadas) {
		const quem = mascarar(contato.telefone);
		const comSair = !jaReservadas.some((r) => r.contatoId === contato.id);
		let jid = contato.jid;
		try {
			if (!jid) {
				const achado = await this.d.whatsapp.resolverJid(contato.telefone);
				if (achado === null) {
					if (await this.d.banco.reservarEnvio(contato.id, chave, tipo)) {
						jaReservadas.push({
							contatoId: contato.id,
							chave
						});
						await this.d.banco.fecharEnvio(contato.id, chave, "falhou", ERRO_SEM_WHATSAPP);
						this.d.registrar(`${quem}: ${ERRO_SEM_WHATSAPP}`);
					}
					return false;
				}
				jid = achado;
				try {
					await this.d.banco.guardarJid(contato.id, jid);
				} catch (e) {
					this.d.registrar(`${quem}: não guardei o endereço: ${mensagemDe$1(e)}`);
				}
			}
			const reservou = await this.d.banco.reservarEnvio(contato.id, chave, tipo);
			jaReservadas.push({
				contatoId: contato.id,
				chave
			});
			if (!reservou) return false;
		} catch (e) {
			this.d.registrar(`${quem}: não mandei ${tipo}: ${mensagemDe$1(e)}`);
			return false;
		}
		try {
			await this.d.whatsapp.enviar(jid, montarMensagem(contato, texto, this.d.agora(), comSair));
		} catch (e) {
			this.d.registrar(`${quem}: falha ao enviar ${tipo}: ${mensagemDe$1(e)}`);
			await this.fechar(contato.id, chave, quem, "falhou", mensagemDe$1(e));
			return true;
		}
		this.contador.contar(contato.id);
		this.d.registrar(`enviado ${tipo} a ${quem}`);
		await this.fechar(contato.id, chave, quem, "enviado");
		try {
			await this.d.banco.gravarEstado({
				conectado: true,
				ultimoEnvioEm: new Date(this.d.agora()).toISOString()
			});
		} catch (e) {
			this.d.registrar(`não gravei o último envio: ${mensagemDe$1(e)}`);
		}
		return true;
	}
	async fechar(contatoId, chave, quem, situacao, erro) {
		try {
			await this.d.banco.fecharEnvio(contatoId, chave, situacao, erro);
		} catch (e) {
			this.d.registrar(`${quem}: não fechei o envio: ${mensagemDe$1(e)}`);
		}
	}
	ensaiar(contato, tipo, chave, texto, jaReservadas) {
		const marca = `${contato.id}|${chave}`;
		if (this.ensaiados.has(marca)) return;
		const prefixoDoDia = `${contato.id}|${chave.split(":")[0]}:`;
		const comSair = !jaReservadas.some((r) => r.contatoId === contato.id) && ![...this.ensaiados].some((m) => m.startsWith(prefixoDoDia));
		this.ensaiados.add(marca);
		const mensagem = montarMensagem(contato, texto, this.d.agora(), comSair).replaceAll("\n", " / ");
		this.d.registrar(`ensaio: enviaria ${tipo} a ${mascarar(contato.telefone)}: ${mensagem}`);
	}
	/** Resposta a ATIVAR/SAIR: respeita o teto do dia e conta nele. */
	async responder(jid, quem, texto) {
		if (!this.contador.podeMensagem()) {
			await this.avisarTetoDoDia();
			return;
		}
		try {
			await this.d.whatsapp.enviar(jid, texto);
			this.contador.contar(null);
		} catch (e) {
			this.d.registrar(`${quem}: não consegui responder: ${mensagemDe$1(e)}`);
		}
	}
};
//#endregion
//#region src/servidor/whatsapp.ts
/** Conexão do WhatsApp do serviço (Baileys). É o único arquivo que importa a biblioteca. */
var ESPERA_MINIMA = 5e3;
var ESPERA_MAXIMA = 3e5;
var MOTIVO_SEM_RECONEXAO = {
	[DisconnectReason.loggedOut]: "sessão encerrada no celular",
	[DisconnectReason.connectionReplaced]: "sessão em uso em outro lugar",
	[DisconnectReason.forbidden]: "acesso recusado pelo WhatsApp"
};
var textoDoErro = (e) => e instanceof Error ? e.message : "erro";
/** Só o texto de uma mensagem de conversa individual vinda de outra pessoa; o resto vira `null`. */
function lerRecebida(m) {
	if (m.key.fromMe) return null;
	const bruto = m.key.remoteJid ?? "";
	const jid = bruto.endsWith("@lid") ? m.key.remoteJidAlt ?? "" : bruto;
	if (!jid || chaveDoNumero(jid) === null) return null;
	const texto = m.message?.conversation ?? m.message?.extendedTextMessage?.text;
	return texto ? {
		jid,
		texto
	} : null;
}
var registradorSilencioso = {
	level: "silent",
	child() {
		return registradorSilencioso;
	},
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {}
};
var dormirDeVerdade = (ms) => new Promise((r) => setTimeout(r, ms));
async function conectarWhatsapp(opcoes) {
	const dep = opcoes.dependencias;
	const criarSocket = dep?.criarSocket ?? ((config) => makeWASocket(config));
	const estadoDaSessao = dep?.estadoDaSessao ?? useMultiFileAuthState;
	const dormir = dep?.dormir ?? dormirDeVerdade;
	const { state, saveCreds } = await estadoDaSessao(opcoes.pastaSessao);
	let version;
	if (!dep) try {
		version = (await fetchLatestBaileysVersion()).version;
	} catch {
		version = void 0;
	}
	let socket;
	let conectado = false;
	let precisaParear = false;
	let encerrado = false;
	let reconectando = false;
	let espera = ESPERA_MINIMA;
	const numeroParaCodigo = opcoes.numeroParaCodigo?.replace(/\D/g, "");
	async function gravarSessao() {
		try {
			await saveCreds();
		} catch (e) {
			console.log(`[whatsapp] falha ao gravar a sessão: ${textoDoErro(e)}`);
		}
	}
	const falhouAoReceber = (e) => console.log(`[whatsapp] falha ao tratar uma mensagem recebida: ${e instanceof Error ? e.name : "erro"}`);
	function abrir() {
		const s = criarSocket({
			auth: state,
			...version ? { version } : {},
			browser: Browsers.ubuntu("Locks SAT"),
			markOnlineOnConnect: false,
			syncFullHistory: false,
			shouldSyncHistoryMessage: () => false,
			logger: registradorSilencioso
		});
		socket = s;
		let codigoPedido = false;
		const atual = () => socket === s && !encerrado;
		s.ev.on("creds.update", () => {
			gravarSessao();
		});
		s.ev.on("connection.update", ((u) => {
			if (!atual()) return;
			if (u.qr) {
				opcoes.aoPedirQr?.(u.qr);
				if (numeroParaCodigo && !codigoPedido && !s.authState.creds.registered) {
					codigoPedido = true;
					s.requestPairingCode(numeroParaCodigo).then((codigo) => opcoes.aoReceberCodigo?.(codigo)).catch((e) => console.log(`[whatsapp] não consegui pedir o código de pareamento (${mascarar(numeroParaCodigo)}): ${textoDoErro(e)}`));
				}
			}
			if (u.connection === "open") {
				conectado = true;
				precisaParear = false;
				espera = ESPERA_MINIMA;
				opcoes.aoMudarConexao(true);
			} else if (u.connection === "close") {
				conectado = false;
				const codigo = (u.lastDisconnect?.error)?.output?.statusCode;
				const motivoFixo = codigo === void 0 ? void 0 : MOTIVO_SEM_RECONEXAO[codigo];
				if (motivoFixo) {
					precisaParear = true;
					opcoes.aoMudarConexao(false, motivoFixo);
					return;
				}
				opcoes.aoMudarConexao(false, `conexão perdida${codigo ? ` (${codigo})` : ""}`);
				reconectar();
			}
		}));
		s.ev.on("messages.upsert", ((e) => {
			if (!atual() || e.type !== "notify") return;
			for (const m of e.messages) try {
				const recebida = lerRecebida(m);
				if (recebida) Promise.resolve(opcoes.aoReceber(recebida)).catch(falhouAoReceber);
			} catch (erro) {
				falhouAoReceber(erro);
			}
		}));
	}
	async function reconectar() {
		if (reconectando) return;
		reconectando = true;
		try {
			while (!encerrado) {
				const ms = espera;
				espera = Math.min(espera * 2, ESPERA_MAXIMA);
				console.log(`[whatsapp] nova tentativa de conexão em ${Math.round(ms / 1e3)} s`);
				await dormir(ms);
				if (encerrado) return;
				try {
					abrir();
					return;
				} catch (e) {
					console.log(`[whatsapp] falha ao reabrir a conexão: ${textoDoErro(e)}`);
				}
			}
		} finally {
			reconectando = false;
		}
	}
	abrir();
	return {
		get conectado() {
			return conectado;
		},
		get precisaParear() {
			return precisaParear;
		},
		async enviar(jid, texto) {
			if (!conectado || !socket) throw new Error("WhatsApp desconectado");
			const s = socket;
			await s.sendPresenceUpdate("composing", jid);
			try {
				await dormir(tempoDigitando());
			} finally {
				await s.sendPresenceUpdate("paused", jid).catch(() => {});
			}
			await s.sendMessage(jid, { text: texto });
		},
		async resolverJid(telefone) {
			if (!conectado || !socket) throw new Error("WhatsApp desconectado");
			const primeiro = (await socket.onWhatsApp(telefone.replace(/\D/g, "")))?.[0];
			return primeiro?.exists ? primeiro.jid : null;
		},
		async encerrar() {
			encerrado = true;
			conectado = false;
			await socket?.end(void 0);
			await gravarSessao();
		}
	};
}
//#endregion
//#region src/servidor/principal.ts
/**
* Linha de comando do serviço da VM (`node locks-sat-whatsapp.mjs [modo]`). Sem argumento é o serviço
* de verdade; os outros modos são para quem instala: parear o número, ensaiar e testar o envio.
*/
var FUSO = "America/Cuiaba";
var ACEITOS = "sem argumento (liga o serviço) | --parear [número] | --ensaio | --teste <número>";
var TEXTO_DO_TESTE = "Teste do Locks SAT: o envio pelo WhatsApp está funcionando.";
var VOLTA_MS = 6e4;
var ESPERA_PARA_CONECTAR_MS = 9e4;
/** Depois de abrir ou de mandar, o Baileys ainda grava a sessão e entrega a mensagem: sair já perderia isso. */
var FOLGA_ANTES_DE_SAIR_MS = 3e3;
var LIMITE_PARA_PARAR_MS = 15e3;
var SESSAO_ENCERRADA = "Sessão encerrada: é preciso parear de novo (ver LEIA-ME).";
function lerArgumentos(argv) {
	const [primeiro, segundo, ...resto] = argv;
	const invalido = () => /* @__PURE__ */ new Error(`Argumento não reconhecido. Aceitos: ${ACEITOS}.`);
	if (primeiro === void 0) return { modo: "servico" };
	if (resto.length > 0) throw invalido();
	if (primeiro === "--parear") return segundo === void 0 ? { modo: "parear" } : {
		modo: "parear",
		numero: segundo
	};
	if (primeiro === "--teste") {
		if (segundo === void 0) throw new Error("Falta o número para o teste: --teste <número>.");
		return {
			modo: "teste",
			numero: segundo
		};
	}
	if (primeiro === "--ensaio" && segundo === void 0) return { modo: "ensaio" };
	throw invalido();
}
var lerVariavel = (env, nome) => {
	const valor = env[nome]?.trim();
	if (!valor) throw new Error(`Falta ${nome} no arquivo de ambiente (/home/locks-sat/.locks-sat-whatsapp.env).`);
	return valor;
};
/** Pasta da sessão do WhatsApp: o pareamento e o teste só precisam dela, não do Supabase. */
var pastaDaSessao = (env) => env.LOCKS_SAT_SESSAO?.trim() || "./sessao";
function lerAmbiente(env) {
	return {
		url: lerVariavel(env, "SUPABASE_URL"),
		chave: lerVariavel(env, "SUPABASE_SERVICE_ROLE_KEY"),
		pastaSessao: pastaDaSessao(env)
	};
}
var fusoCerto = (tz) => tz === FUSO;
/** `AAAA-MM-DDTHH:MM:SS` na hora local do processo, e a linha. */
function linhaDeRegistro(agora, linha) {
	const d = new Date(agora);
	const dois = (n) => String(n).padStart(2, "0");
	return `${`${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`}T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())} ${linha}`;
}
/** Minutos do dia que o ensaio percorre: 07:00, 12:00 e o "antes" de cada janela de hoje. */
function horariosDoEnsaio(porCelula) {
	const minutos = /* @__PURE__ */ new Set([420, 720]);
	for (const janelas of Object.values(porCelula)) for (const j of janelas) minutos.add(Math.max(0, j.inicio - 30));
	return [...minutos].sort((a, b) => a - b);
}
var registrar = (linha) => console.log(linhaDeRegistro(Date.now(), linha));
var dormir = (ms) => new Promise((r) => setTimeout(r, ms));
var mensagemDe = (e) => e instanceof Error ? e.message : String(e);
/** O fuso que o processo realmente usa (vale também se vier do sistema, não só da variável TZ). */
var fusoDoProcesso = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
function exigirFuso(fuso) {
	if (!fusoCerto(fuso)) throw new Error(`O fuso do processo precisa ser ${FUSO} (TZ=${FUSO}): as janelas e os horários dos alertas dependem dele. Hoje: ${fuso}.`);
}
/** O serviço de verdade: fica ligado, olha o relógio a cada minuto e atende ATIVAR/SAIR. */
async function servico(env) {
	exigirFuso(fusoDoProcesso());
	const { url, chave, pastaSessao } = lerAmbiente(env);
	let whatsapp = null;
	const ponte = {
		get conectado() {
			return whatsapp?.conectado ?? false;
		},
		get precisaParear() {
			return whatsapp?.precisaParear ?? false;
		},
		enviar: (jid, texto) => whatsapp ? whatsapp.enviar(jid, texto) : Promise.reject(/* @__PURE__ */ new Error("WhatsApp desconectado")),
		resolverJid: (telefone) => whatsapp ? whatsapp.resolverJid(telefone) : Promise.reject(/* @__PURE__ */ new Error("WhatsApp desconectado"))
	};
	const s = new Servico({
		banco: criarBanco({
			url,
			chave
		}),
		trimble: criarTrimble(),
		whatsapp: ponte,
		agora: Date.now,
		dormir,
		registrar
	});
	whatsapp = await conectarWhatsapp({
		pastaSessao,
		aoReceber: async (m) => {
			try {
				await s.recebida(m);
			} catch (e) {
				registrar(`falha ao tratar mensagem: ${mensagemDe(e)}`);
			}
		},
		aoMudarConexao: async (conectado, motivo) => {
			if (ponte.precisaParear) registrar(SESSAO_ENCERRADA);
			try {
				await s.conexao(conectado, motivo);
			} catch (e) {
				registrar(`falha ao tratar a conexão: ${mensagemDe(e)}`);
			}
		}
	});
	let emVolta = false;
	const relogio = setInterval(() => {
		if (emVolta) return;
		emVolta = true;
		s.volta().catch((e) => registrar(`falha na volta: ${mensagemDe(e)}`)).finally(() => {
			emVolta = false;
		});
	}, VOLTA_MS);
	let parando = false;
	const parar = (sinal) => {
		if (parando) return;
		parando = true;
		clearInterval(relogio);
		registrar(`${sinal} recebido: parando o serviço`);
		setTimeout(() => process.exit(0), LIMITE_PARA_PARAR_MS).unref();
		(async () => {
			try {
				await whatsapp?.encerrar();
			} catch (e) {
				registrar(`falha ao encerrar a conexão: ${mensagemDe(e)}`);
			}
			try {
				await s.conexao(false, "serviço parado");
			} catch (e) {
				registrar(`não gravei o estado: ${mensagemDe(e)}`);
			}
			process.exit(0);
		})();
	};
	process.on("SIGTERM", () => parar("SIGTERM"));
	process.on("SIGINT", () => parar("SIGINT"));
	registrar("serviço ligado");
}
/** Mostra o QR (ou o código de 8 dígitos, se vier o número) até o celular aceitar; então escreve "Pareado.". */
async function parear(env, numero) {
	const modulo = await import("qrcode-terminal");
	const generate = (modulo.default ?? modulo).generate;
	let whatsapp;
	let terminar = () => {};
	const fim = new Promise((r) => {
		terminar = r;
	});
	whatsapp = await conectarWhatsapp({
		pastaSessao: pastaDaSessao(env),
		numeroParaCodigo: numero,
		aoReceber: () => {},
		aoPedirQr: (qr) => {
			if (numero) return;
			console.log("No celular do COA: WhatsApp → Aparelhos conectados → Conectar um aparelho, e leia o código abaixo.");
			generate(qr, { small: true });
		},
		aoReceberCodigo: (codigo) => {
			const legivel = codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
			console.log(`Código de pareamento: ${legivel}`);
			console.log("No celular: Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone, e digite o código.");
		},
		aoMudarConexao: (conectado) => {
			if (conectado) {
				console.log("Pareado.");
				terminar(0);
			} else if (whatsapp?.precisaParear) {
				console.log("A sessão guardada foi encerrada no celular. Apague a pasta da sessão e pareie de novo (ver LEIA-ME).");
				terminar(1);
			}
		}
	});
	const codigo = await fim;
	await dormir(FOLGA_ANTES_DE_SAIR_MS);
	await whatsapp.encerrar();
	return codigo;
}
/** Percorre o dia de hoje (07:00, 12:00 e o "antes" das janelas) com dados reais e escreve o que enviaria. Não conecta ao WhatsApp e não grava nada. */
async function ensaio(env, fuso = fusoDoProcesso()) {
	exigirFuso(fuso);
	const { url, chave } = lerAmbiente(env);
	const trimble = criarTrimble();
	const historicos = /* @__PURE__ */ new Map();
	const janelasPorCelula = {};
	let primeiraVoltaFeita = false;
	const dia = inicioDoDiaLocal(Date.now());
	let agora = dia;
	const servico = new Servico({
		banco: criarBanco({
			url,
			chave
		}),
		trimble: { async historico(celula, quando) {
			const id = `${celula.lat}_${celula.lon}`;
			let historico = historicos.get(id);
			if (!historico) {
				historico = await trimble.historico(celula, quando);
				historicos.set(id, historico);
				janelasPorCelula[id] = janelasDeHoje(historico);
			}
			return historico;
		} },
		whatsapp: {
			conectado: true,
			precisaParear: false,
			enviar: () => Promise.reject(/* @__PURE__ */ new Error("o ensaio não envia")),
			resolverJid: () => Promise.reject(/* @__PURE__ */ new Error("o ensaio não consulta o WhatsApp"))
		},
		agora: () => agora,
		dormir: (ms) => primeiraVoltaFeita ? Promise.resolve() : dormir(ms),
		registrar,
		ensaio: true
	});
	registrar("ensaio: nada é enviado nem gravado; os horários abaixo são os de hoje");
	agora = dia + 3e5;
	await servico.volta();
	primeiraVoltaFeita = true;
	for (const minuto of horariosDoEnsaio(janelasPorCelula)) {
		agora = dia + minuto * 6e4;
		registrar(`ensaio: ${String(Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}`);
		await servico.volta();
	}
	registrar("ensaio: fim");
	return 0;
}
/** Manda uma mensagem de teste a um número e encerra. Não lê nem grava nada no banco. */
async function teste(env, numero) {
	let whatsapp;
	let abriu = () => {};
	let falhou = () => {};
	const aberta = new Promise((res, rej) => {
		abriu = res;
		falhou = rej;
	});
	aberta.catch(() => {});
	const prazo = setTimeout(() => falhou(/* @__PURE__ */ new Error("Não conectei ao WhatsApp em 90 segundos. Se o número ainda não foi pareado, pareie primeiro (ver LEIA-ME).")), ESPERA_PARA_CONECTAR_MS);
	try {
		whatsapp = await conectarWhatsapp({
			pastaSessao: pastaDaSessao(env),
			aoReceber: () => {},
			aoMudarConexao: (conectado) => {
				if (conectado) abriu();
				else if (whatsapp?.precisaParear) falhou(/* @__PURE__ */ new Error(SESSAO_ENCERRADA));
			}
		});
		await aberta;
		const jid = await whatsapp.resolverJid(numero);
		if (!jid) throw new Error(`O número ${mascarar(numero)} não tem WhatsApp.`);
		await whatsapp.enviar(jid, TEXTO_DO_TESTE);
		console.log(`Enviado para ${mascarar(numero)}`);
		await dormir(FOLGA_ANTES_DE_SAIR_MS);
	} finally {
		clearTimeout(prazo);
		await whatsapp?.encerrar();
	}
	return 0;
}
/** Código de saída do programa; `undefined` no serviço, que não termina sozinho. */
async function principal(argv, env = process.env) {
	const { modo, numero } = lerArgumentos(argv);
	if (modo === "parear") return parear(env, numero);
	if (modo === "ensaio") return ensaio(env);
	if (modo === "teste") return teste(env, numero);
	await servico(env);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal(process.argv.slice(2)).then((codigo) => {
	if (codigo !== void 0) process.exit(codigo);
}).catch((e) => {
	console.error(`Erro: ${mensagemDe(e)}`);
	process.exit(1);
});
//#endregion
export { ensaio, fusoCerto, horariosDoEnsaio, lerAmbiente, lerArgumentos, linhaDeRegistro, pastaDaSessao, principal };
