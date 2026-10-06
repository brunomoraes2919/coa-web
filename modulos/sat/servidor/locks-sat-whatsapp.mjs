import { readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import makeWASocket, { Browsers, DisconnectReason, WAMessageStatus, fetchLatestBaileysVersion, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState } from "baileys";
//#region src/logic/tempo.ts
var MINUTOS_DIA = 1440;
var HORA_MS$1 = 36e5;
var DIA_MS = 24 * HORA_MS$1;
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
/** 'DD/MM' local de um instante. */
function dataCurta(ms) {
	const d = new Date(ms);
	return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
3 * HORA_MS$1;
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
				jid: l.jid ?? null,
				atualizadoEm: l.atualizado_em ?? null
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
			return (await lerTudo("ler os envios do dia", "whatsapp_envios", `select=contato_id,chave,situacao&chave=like.${encodeURIComponent(dia)}:*&order=contato_id,chave`)).map((l) => ({
				contatoId: l.contato_id,
				chave: l.chave,
				situacao: l.situacao
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
/** O "começa em breve" é no máximo um por noite: a janela depois da meia-noite pertence à noite anterior. */
function chaveDoAntes(agora) {
	return chaveEvento(agora - 12 * HORA_MS$1, "antes");
}
function eventosFixosNaHora(agora) {
	const m = minutoDoDia(agora);
	const naHora = (inicio) => m >= inicio && m <= inicio + 60;
	const eventos = [];
	if (naHora(420)) eventos.push("resumo-07");
	if (naHora(720)) eventos.push("lembrete-12");
	return eventos;
}
/** Os horários de cálculo de hoje e o último de ontem (cobre a virada do dia), em ordem. */
function marcosDeCalculo(agora) {
	const dia = inicioDoDiaLocal(agora);
	return [dia - DIA_MS + MINUTOS_DE_CALCULO[MINUTOS_DE_CALCULO.length - 1] * 6e4, ...MINUTOS_DE_CALCULO.map((m) => dia + m * 6e4)];
}
/** Já passou de algum horário de cálculo desde o último? (`null` = nunca calculou.) */
function precisaCalcular(agora, calculadoEm) {
	if (calculadoEm == null) return true;
	return marcosDeCalculo(agora).some((marco) => marco <= agora && marco > calculadoEm);
}
/** O horário de cálculo mais recente que já passou: cada um abre uma rodada nova de tentativas. */
function ultimoMarcoDeCalculo(agora) {
	return Math.max(...marcosDeCalculo(agora).filter((marco) => marco <= agora));
}
/** A janela que começa primeiro dentro dos próximos 30 min (ou agora); `null` se nenhuma. */
function janelaDoAntes(janelas, agora) {
	const m = minutoDoDia(agora);
	const perto = janelas.filter((j) => j.inicio - m >= 0 && j.inicio - m <= 30);
	return perto.length ? perto.reduce((a, b) => b.inicio < a.inicio ? b : a) : null;
}
//#endregion
//#region src/componentes/ajudaTextos.ts
var AJUDA = {
	cintilacao: {
		titulo: "Cintilação ionosférica",
		oQueE: "Oscilação rápida na força e na fase do sinal dos satélites quando ele atravessa bolhas de irregularidade na ionosfera. A Trimble mede isso na rede de estações dela e dá uma nota de 0 a 100: mínima (até 32), média (33 a 65) e forte (66 ou mais).",
		quando: "Perto do equador, logo depois do pôr do sol, por algumas horas — com mais força entre setembro e março. É o caso das fazendas do Mato Grosso.",
		fazer: "Média: acompanhe o status da correção no monitor e evite abrir linhas AB novas. Forte: adie o que precisa de precisão de centímetro — plantio, pulverização com corte de seção, voo de drone em RTK. Usar duas frequências (L1/L2) não resolve cintilação.",
		rtk: "Mínima: operação normal, RTK fixo estável. Média: o receptor perde alguns satélites e o RTK pode cair de fixo (cerca de 2 cm) para flutuante (decímetros) por alguns minutos, e demora mais para fixar de novo. Forte: perde o fixo com frequência; o piloto automático pode desarmar ou desviar da linha, deixando falha e sobreposição entre passadas."
	},
	indice: {
		titulo: "Índice ionosférico",
		oQueE: "Nota de 0 a 10 que a Trimble calcula para a atividade da ionosfera no ponto. Diferente da cintilação, ela vem com PREVISÃO para as próximas horas. Verde até 4, amarelo de 5 a 7, vermelho de 8 a 10.",
		quando: "Sobe com o sol (pico no começo da tarde), nos anos de sol mais ativo e perto dos equinócios (março e setembro).",
		fazer: "Use a previsão para programar o turno: com amarelo, acompanhe o status da correção; com vermelho, deixe plantio, pulverização com corte de seção e voo em RTK para fora desse horário.",
		rtk: "Verde: sem efeito no RTK. Amarelo: o RTK demora mais para fixar e a precisão piora quanto mais longe estiver a base. Vermelho: quedas de fixo para flutuante ficam prováveis, principalmente com a base distante."
	},
	tec: {
		titulo: "TEC (conteúdo total de elétrons)",
		oQueE: "Quantidade de elétrons no caminho do sinal, em TECU. Cada 1 TECU atrasa o sinal L1 em cerca de 16 cm — é o erro que o receptor de duas frequências e o RTK corrigem.",
		quando: "Maior no começo da tarde e na faixa equatorial.",
		fazer: "Use como contexto do índice ionosférico. Se o TEC estiver alto e a base for distante, confira o status da correção antes de começar.",
		rtk: "O RTK cancela quase todo esse atraso porque a base enxerga praticamente a mesma ionosfera que a máquina. Quanto mais longe a base (rádio ou rede via celular), mais erro sobra e mais o RTK demora para fixar com TEC alto. Com a base perto, TEC alto quase não muda a operação."
	},
	janela: {
		titulo: "Janela de risco pelo histórico",
		oQueE: "Horários de hoje em que, nos últimos 7 dias, houve cintilação média ou forte em pelo menos 3 dias naquela fazenda. É estimativa pelo que vem acontecendo — a Trimble não prevê cintilação. Horários a menos de 30 minutos um do outro contam como uma janela só.",
		quando: "Costuma aparecer à noite, entre o pôr do sol e a madrugada.",
		fazer: "Use para programar: deixe fora dessa janela o que depende de RTK fixo (plantio, pulverização em faixa, voo). O resumo do dia chega de manhã, e um aviso 30 minutos antes da primeira janela da noite.",
		rtk: "É nesse horário que o RTK mais costuma cair de fixo para flutuante e o piloto automático desarmar. Plantio ou pulverização à noite dentro da janela tem mais chance de falha e sobreposição entre passadas."
	}
};
/** O efeito na operação que acompanha cada aviso de janela de risco no WhatsApp: três redações, uma por aviso. */
var EFEITO_DA_JANELA = {
	/** No resumo: a frase do "?" da janela (o mesmo texto da tela). */
	naOperacao: AJUDA.janela.rtk.charAt(0).toLowerCase() + AJUDA.janela.rtk.slice(1),
	oQueFazer: "deixe fora dessa janela o que depende de RTK fixo: plantio, pulverização com corte de seção e voo de drone em RTK.",
	lembrete: "Programe para antes ou depois o que depende de RTK fixo (plantio, pulverização com corte de seção, voo de drone).",
	antes: "A partir de agora o RTK pode cair de fixo para flutuante e o piloto automático desarmar. Acompanhe o status da correção no monitor e evite abrir linhas AB novas."
};
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
/** O que o aviso afeta na operação: cada tipo com as suas palavras (o mesmo texto repetido no dia parece robô). */
function efeitoNaOperacao(tipo) {
	if (tipo === "resumo-07") return [
		"",
		`*Na operação:* ${EFEITO_DA_JANELA.naOperacao}`,
		`*O que fazer:* ${EFEITO_DA_JANELA.oQueFazer}`
	];
	return [tipo === "lembrete-12" ? EFEITO_DA_JANELA.lembrete : EFEITO_DA_JANELA.antes];
}
function montarMensagem(tipo, contato, texto, agora, comSair) {
	const linhas = [
		TITULO,
		`${saudacao(agora)}, ${primeiroNome(contato)}.`,
		texto,
		...efeitoNaOperacao(tipo)
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
var RESPOSTAS_NO_MINIMO_MS = 3e3;
var RESPOSTAS_NO_MAXIMO_MS = 8e3;
/** Entre uma resposta de ATIVAR/SAIR e a próxima: duas saindo no mesmo instante são sinal de robô. */
function pausaEntreRespostas(sorteio = Math.random) {
	return entre(RESPOSTAS_NO_MINIMO_MS, RESPOSTAS_NO_MAXIMO_MS, sorteio);
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
/** Uma rodada de cálculo insiste (a cada 5 min) durante este tempo: é a tolerância de atraso do evento. */
var INSISTENCIA_NA_TRIMBLE_MS = HORA_MS$1;
/** Passada a insistência sem resposta, a Trimble é consultada só uma vez por hora (até o próximo horário de cálculo). */
var NOVA_TENTATIVA_LENTA_TRIMBLE_MS = HORA_MS$1;
var PAUSA_ENTRE_QUADRADOS_MS = 2e3;
/** `enviar` e `resolverJid` podem ficar pendurados; sem prazo travariam o laço para sempre. */
var PRAZO_DO_WHATSAPP_MS = 6e4;
/** Na parada, quanto se espera pelas gravações de SAIR/ATIVAR já recebidas (a parada não interrompe esta espera). */
var PRAZO_DAS_GRAVACOES_MS = 1e4;
/** 00:05: a primeira volta depois disso, a cada dia, apaga os envios antigos. */
var MINUTO_DA_LIMPEZA = MINUTOS_DE_CALCULO[0];
var MAX_RESPOSTAS_POR_PESSOA_POR_DIA = 2;
/** O carimbo do ATIVAR vem do WhatsApp e o `atualizadoEm` do relógio de quem gravou, que pode estar adiantado alguns minutos. */
var MARGEM_DO_RELOGIO_MS = 6e5;
/** O WhatsApp recusar tantas mensagens seguidas é sinal de conta restrita: insistir piora. */
var MAX_RECUSAS_SEGUIDAS = 3;
var ERRO_TETO_DO_DIA = "teto diário de mensagens atingido";
var ERRO_SEM_WHATSAPP = "número sem WhatsApp";
var ERRO_PEDIU_PARA_SAIR = "pediu para sair";
var ERRO_RESTRICAO = "WhatsApp restringiu os envios";
/** Prazo de restrição a menos que isto à frente não é do servidor: é o "agora + 60 s" que a biblioteca põe quando ele não diz até quando. */
var PRAZO_MINIMO_DE_RESTRICAO_MS = 6e5;
/** Sem prazo de verdade, a restrição vale isto a partir de agora. */
var RESTRICAO_SEM_PRAZO_MS = 6 * HORA_MS$1;
var ERRO_RECUSAS = `WhatsApp recusou ${MAX_RECUSAS_SEGUIDAS} mensagens seguidas`;
var ESTOUROU = Symbol("prazo estourado");
/** Os avisos que o site mostra em `ultimo_erro`, na ordem em que aparecem quando há mais de um. */
var TIPOS_DE_AVISO = [
	"restricao",
	"recusas",
	"teto",
	"trimble"
];
var ENTRE_AVISOS = " · ";
var PrazoEstourado = class extends Error {
	constructor() {
		super(`sem resposta do WhatsApp em ${PRAZO_DO_WHATSAPP_MS / 1e3} s`);
	}
};
var mensagemDe$1 = (e) => e instanceof Error ? e.message : String(e);
/** Os dígitos do número que vem num endereço do WhatsApp (sem servidor nem aparelho). */
var numeroDoJid = (jid) => jid.split("@")[0].split(":")[0];
/** Troca todo número de telefone inteiro (55 + DDD + número, 12 ou 13 dígitos) pelos 4 últimos dígitos. */
function semNumeros(texto) {
	return texto.replace(/(?<!\d)55\d{10,11}(?!\d)/g, (n) => `…${n.slice(-4)}`);
}
var Servico = class {
	d;
	contador;
	janelas = null;
	/** As fazendas lidas junto do cálculo das janelas: a geometria dos talhões é pesada demais para reler a cada minuto. */
	fazendas = null;
	rodada = null;
	falhasDaTrimble = null;
	/** A primeira falha da Trimble desde o último cálculo que deu certo: é o "desde" do aviso. */
	semTrimbleDesde = null;
	ultimoBatimento = null;
	diaDaLimpeza = "";
	diaDoAvisoDeTeto = "";
	emVolta = false;
	semeado = false;
	/**
	* Números (`chaveDoNumero`) de quem mandou SAIR e cuja pausa o banco ainda não mostrou, com a ordem
	* de chegada desse SAIR: ninguém marcado recebe nada. A marca só sai quando a leitura do banco já
	* traz `ativo === false` ou quando um ATIVAR que chegou DEPOIS do SAIR foi gravado.
	*/
	pausados = /* @__PURE__ */ new Map();
	/** Contador da ordem de chegada dos comandos (ATIVAR/SAIR). */
	chegadas = 0;
	/** Só no ensaio: o que já foi registrado, para não repetir a cada minuto. */
	ensaiados = /* @__PURE__ */ new Set();
	ensaioExplicado = false;
	/** Números que o WhatsApp disse não existir, no dia: perguntar de novo todo minuto parece robô. */
	semWhatsapp = {
		dia: "",
		telefones: /* @__PURE__ */ new Set()
	};
	respostas = /* @__PURE__ */ new Map();
	/**
	* Duas filas. A de gravação trata os comandos recebidos um por vez, na ordem de chegada e sem pausa:
	* um SAIR tem de chegar ao banco antes de qualquer outra coisa (a ponta da fila é esta promessa).
	* A de respostas envia uma por vez, com a pausa entre elas.
	*/
	filaDeGravacao = Promise.resolve();
	gravacoesPendentes = 0;
	filaDeRespostas = Promise.resolve();
	ultimaResposta = null;
	/** Até quando o WhatsApp restringiu os envios da conta (`Infinity` = sem prazo informado). */
	restritoAte = null;
	recusasSeguidas = 0;
	recusaDesdeOUltimoEnvio = false;
	/** O dia em que as recusas seguidas pararam os envios (até o dia seguinte). */
	diaDasRecusas = "";
	avisos = /* @__PURE__ */ new Map();
	/** O que está gravado em `ultimo_erro`; `undefined` = não se sabe (uma gravação falhou, ou está lá o motivo de uma queda). */
	avisoGravado = null;
	/** O dia (`chaveData`) para o qual alguém pediu o resumo à mão; `null` = nenhum pedido pendente. */
	pedidoDeResumo = null;
	constructor(d) {
		this.d = d;
		this.contador = new ContadorDoDia(d.agora);
	}
	/**
	* Pede o resumo de hoje fora do horário (o sinal da VM). Só guarda o pedido: quem envia é a volta,
	* pelo caminho normal, com todos os freios. No ensaio não muda nada (o ensaio já mostra o resumo).
	*/
	pedirResumoDeHoje() {
		if (this.d.ensaio) return;
		this.pedidoDeResumo = chaveData(this.d.agora());
		this.registrar("resumo de hoje pedido à mão");
	}
	/** Uma volta do laço: calcula se precisa, manda o que está na hora, grava o batimento a cada 5 min. */
	async volta() {
		if (this.emVolta) return;
		this.emVolta = true;
		try {
			const agora = this.d.agora();
			if (this.pedidoDeResumo !== null && this.pedidoDeResumo !== chaveData(agora)) this.pedidoDeResumo = null;
			await this.bater(agora);
			await this.vencerAvisos(agora);
			await this.limparUmaVezPorDia(agora);
			await this.calcularSePreciso(agora);
			const janelas = this.janelas;
			const valida = janelas !== null && chaveData(janelas.calculadoEm) === chaveData(agora);
			if (this.d.ensaio && valida && !this.ensaioExplicado) await this.explicarEnsaio(janelas);
			const podeEnviar = this.d.ensaio || this.d.whatsapp.conectado && this.bloqueio() === null;
			if (valida && podeEnviar && this.algoNaHora(agora, janelas)) await this.enviarEventos(agora, janelas);
			else if (this.pausados.size && !this.d.ensaio) await this.reconciliarPausados(await this.d.banco.contatos());
		} catch (e) {
			this.registrar(`falha na volta: ${mensagemDe$1(e)}`);
		} finally {
			this.emVolta = false;
		}
	}
	/**
	* Mensagem recebida de alguém: ATIVAR ou SAIR de contato cadastrado. O comando entra na fila de
	* gravação (um por vez, na ordem de chegada, sem esperar resposta nenhuma) e a resposta, se couber,
	* na fila de respostas. Resolve quando a resposta foi tratada.
	*/
	async recebida(m) {
		const comando = lerComando(m.texto);
		if (!comando) return;
		const quem = mascarar(numeroDoJid(m.jid));
		if (this.d.ensaio) {
			this.registrar(`ensaio: comando de ${quem} ignorado`);
			return;
		}
		const chegada = ++this.chegadas;
		const numero = chaveDoNumero(m.jid);
		if (numero && comando === "sair") this.pausados.set(numero, chegada);
		this.gravacoesPendentes += 1;
		let daResposta = Promise.resolve();
		const gravacao = this.filaDeGravacao.then(async () => {
			try {
				const pedido = await this.gravar(m, comando, numero, quem, chegada);
				if (pedido) daResposta = this.enfileirarResposta(pedido);
			} finally {
				this.gravacoesPendentes -= 1;
			}
		});
		this.filaDeGravacao = gravacao.catch(() => {});
		await gravacao;
		await daResposta;
	}
	/**
	* Espera a fila de gravação esvaziar, no máximo `prazoMs` (o relógio é o `dormir` injetado). Não espera
	* as respostas: o comando já está gravado, e uma resposta que se perder não desfaz nada.
	*/
	async aguardarGravacoes(prazoMs) {
		if (this.gravacoesPendentes === 0) return;
		let venceu = false;
		const prazo = this.d.dormir(prazoMs).then(() => {
			venceu = true;
		});
		while (this.gravacoesPendentes > 0 && !venceu) await Promise.race([this.filaDeGravacao, prazo]);
	}
	/** O WhatsApp restringiu os envios da conta até `ate` (ms; `Infinity` = sem prazo), ou retirou a restrição (`null`). */
	async restricao(ate, motivo) {
		if (this.d.ensaio) return;
		const agora = this.d.agora();
		if (ate === null) {
			if (this.restritoAte === null) return;
			if (this.restritoAte > agora && Number.isFinite(this.restritoAte)) {
				this.registrar("aviso de que a restrição de envios sumiu antes do prazo guardado: ignorado");
				return;
			}
			this.restritoAte = null;
			this.registrar("o WhatsApp retirou a restrição de envios");
			await this.avisar("restricao", null);
			return;
		}
		const presumido = !(ate - agora >= PRAZO_MINIMO_DE_RESTRICAO_MS);
		const prazo = presumido ? agora + RESTRICAO_SEM_PRAZO_MS : ate;
		if (presumido && this.restritoAte !== null && this.restritoAte >= prazo) {
			this.registrar("prazo de restrição de envios sem data de verdade: a restrição já guardada é mais longa e fica");
			return;
		}
		this.restritoAte = prazo;
		const quando = Number.isFinite(prazo) ? `${dataCurta(prazo)} ${horaDe(prazo)}` : "";
		const texto = !Number.isFinite(prazo) ? `${ERRO_RESTRICAO} até novo aviso` : presumido ? `${ERRO_RESTRICAO}: nova tentativa depois de ${quando}` : `${ERRO_RESTRICAO} até ${quando}`;
		this.registrar(`${texto}${motivo ? ` (${motivo})` : ""}: nada sai até lá`);
		await this.avisar("restricao", texto);
	}
	/** O WhatsApp recusou uma mensagem que o serviço mandou. Três seguidas param os envios até o dia seguinte. */
	async falhaDeEntrega(jid) {
		if (this.d.ensaio) return;
		this.recusasSeguidas += 1;
		this.recusaDesdeOUltimoEnvio = true;
		this.registrar(`o WhatsApp recusou a mensagem para ${mascarar(numeroDoJid(jid))} (${this.recusasSeguidas} seguida(s))`);
		const hoje = chaveData(this.d.agora());
		if (this.recusasSeguidas < MAX_RECUSAS_SEGUIDAS || this.diaDasRecusas === hoje) return;
		this.diaDasRecusas = hoje;
		const texto = `${ERRO_RECUSAS}: envios parados até amanhã`;
		this.registrar(texto);
		await this.avisar("recusas", texto);
	}
	/** Estado da conexão mudou. */
	async conexao(conectado, motivo) {
		this.registrar(`WhatsApp ${conectado ? "conectado" : "desconectado"}${motivo ? `: ${motivo}` : ""}`);
		if (this.d.ensaio) return;
		const ultimoErro = conectado ? this.textoDosAvisos() : motivo ? semNumeros(motivo) : null;
		try {
			await this.d.banco.gravarEstado({
				conectado,
				desde: new Date(this.d.agora()).toISOString(),
				ultimoErro
			});
			this.avisoGravado = conectado ? ultimoErro : void 0;
		} catch (e) {
			this.avisoGravado = void 0;
			this.registrar(`não gravei o estado da conexão: ${mensagemDe$1(e)}`);
		}
	}
	/** Todo registro passa por aqui: nunca sai número de telefone inteiro. */
	registrar(linha) {
		this.d.registrar(semNumeros(linha));
	}
	/** Um comando na fila de gravação: lê o contato e grava. Devolve a resposta a mandar, ou `null`. Nunca lança. */
	async gravar(m, comando, numero, quem, chegada) {
		try {
			const contato = (await this.d.banco.contatos()).find((c) => mesmoNumero(c.telefone, m.jid));
			if (!contato) {
				if (numero && this.pausados.get(numero) === chegada) this.pausados.delete(numero);
				this.registrar(`comando de número não cadastrado (${quem}) ignorado`);
				return null;
			}
			let resposta;
			if (comando === "ativar") {
				if (m.em !== null && contato.atualizadoEm !== null && m.em < Date.parse(contato.atualizadoEm) - MARGEM_DO_RELOGIO_MS) {
					this.registrar(`${quem}: mensagem de ativação anterior à última alteração do contato, ignorada`);
					return null;
				}
				await this.d.banco.confirmar(contato.id, m.jid);
				const marca = numero ? this.pausados.get(numero) : void 0;
				if (numero && marca !== void 0 && marca < chegada) this.pausados.delete(numero);
				let nomes = [];
				try {
					const fazendas = this.fazendas ?? await this.d.banco.fazendas();
					nomes = [...new Set(fazendasDoContato(contato, fazendas).map((f) => f.nome))];
				} catch (e) {
					this.registrar(`${quem}: não li as fazendas para a resposta: ${mensagemDe$1(e)}`);
				}
				resposta = textoAtivado(contato, nomes);
				this.registrar(`ativado: ${mascarar(contato.telefone)}`);
			} else {
				await this.d.banco.pausar(contato.id);
				resposta = textoSaiu(contato);
				this.registrar(`pausado: ${mascarar(contato.telefone)}`);
			}
			return {
				contato,
				jid: m.jid,
				quem,
				texto: resposta
			};
		} catch (e) {
			this.registrar(`falha ao tratar mensagem de ${quem}: ${mensagemDe$1(e)}`);
			return null;
		}
	}
	/** Põe a resposta na fila de respostas (uma por vez); a promessa devolvida nunca rejeita. */
	enfileirarResposta(p) {
		const vez = this.filaDeRespostas.then(() => this.responder(p.contato, p.jid, p.quem, p.texto)).catch((e) => this.registrar(`falha ao responder a ${p.quem}: ${mensagemDe$1(e)}`));
		this.filaDeRespostas = vez;
		return vez;
	}
	textoDosAvisos() {
		const textos = TIPOS_DE_AVISO.flatMap((tipo) => this.avisos.get(tipo) ?? []);
		return textos.length ? textos.join(ENTRE_AVISOS) : null;
	}
	/**
	* Liga (com o texto) ou desliga (`null`) um aviso. O `ultimo_erro` do estado leva sempre a junção
	* dos avisos ativos, ou `null` sem nenhum: um aviso que entra ou sai não apaga os outros.
	*/
	async avisar(tipo, texto) {
		if (texto === null) this.avisos.delete(tipo);
		else this.avisos.set(tipo, semNumeros(texto));
		await this.gravarAvisos();
	}
	/** Grava a junção dos avisos se ela mudou (ou se a gravação anterior falhou); chamada também a cada volta. */
	async gravarAvisos() {
		if (this.d.ensaio) return;
		const texto = this.textoDosAvisos();
		if (texto === this.avisoGravado) return;
		if (!this.d.whatsapp.conectado) return;
		try {
			await this.d.banco.gravarEstado({
				conectado: true,
				ultimoErro: texto
			});
			this.avisoGravado = texto;
		} catch (e) {
			this.registrar(`não gravei o aviso do serviço: ${mensagemDe$1(e)}`);
		}
	}
	/** O que impede qualquer envio agora (alerta ou resposta), ou `null`. */
	bloqueio() {
		const agora = this.d.agora();
		if (this.restritoAte !== null && agora < this.restritoAte) return ERRO_RESTRICAO;
		if (this.diaDasRecusas === chaveData(agora)) return ERRO_RECUSAS;
		return null;
	}
	async bater(agora) {
		if (this.d.ensaio) return;
		if (this.ultimoBatimento !== null && agora - this.ultimoBatimento < BATIMENTO_MS) return;
		try {
			await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado });
			this.ultimoBatimento = agora;
		} catch (e) {
			this.registrar(`não gravei o batimento: ${mensagemDe$1(e)}`);
		}
	}
	/** Avisos com prazo: o de teto e o de recusas valem só no dia; o de restrição, até a hora que o WhatsApp deu. */
	async vencerAvisos(agora) {
		const hoje = chaveData(agora);
		if (this.diaDoAvisoDeTeto && this.diaDoAvisoDeTeto !== hoje) {
			this.diaDoAvisoDeTeto = "";
			this.avisos.delete("teto");
		}
		if (this.diaDasRecusas && this.diaDasRecusas !== hoje) {
			this.diaDasRecusas = "";
			this.recusasSeguidas = 0;
			this.recusaDesdeOUltimoEnvio = false;
			this.avisos.delete("recusas");
		}
		if (this.restritoAte !== null && agora >= this.restritoAte) {
			this.restritoAte = null;
			this.avisos.delete("restricao");
			this.registrar("venceu o prazo da restrição de envios do WhatsApp");
		}
		await this.gravarAvisos();
	}
	async limparUmaVezPorDia(agora) {
		const dia = chaveData(agora);
		if (this.d.ensaio || this.diaDaLimpeza === dia || minutoDoDia(agora) < MINUTO_DA_LIMPEZA) return;
		this.diaDaLimpeza = dia;
		try {
			await this.d.banco.limparEnviosAntigos();
		} catch (e) {
			this.registrar(`não limpei os envios antigos: ${mensagemDe$1(e)}`);
		}
	}
	async calcularSePreciso(agora) {
		if (!precisaCalcular(agora, this.janelas?.calculadoEm ?? null)) return;
		const marco = ultimoMarcoDeCalculo(agora);
		const falhas = this.falhasDaTrimble?.marco === marco ? this.falhasDaTrimble : null;
		if (falhas) {
			const insistiu = falhas.ultima - falhas.primeira >= INSISTENCIA_NA_TRIMBLE_MS;
			if (agora - falhas.ultima < (insistiu ? NOVA_TENTATIVA_LENTA_TRIMBLE_MS : NOVA_TENTATIVA_TRIMBLE_MS)) return;
		}
		const dia = chaveData(agora);
		if (!this.rodada || this.rodada.dia !== dia) {
			const fazendas = await this.d.banco.fazendas();
			const quadrados = /* @__PURE__ */ new Map();
			for (const f of fazendas) if (f.celulaId && f.lat != null && f.lon != null) quadrados.set(f.celulaId, {
				lat: f.lat,
				lon: f.lon
			});
			this.rodada = {
				dia,
				fazendas,
				quadrados,
				respondidos: {}
			};
		}
		const rodada = this.rodada;
		try {
			let primeiro = true;
			for (const [id, celula] of rodada.quadrados) {
				if (id in rodada.respondidos) continue;
				if (!primeiro) await this.d.dormir(PAUSA_ENTRE_QUADRADOS_MS);
				primeiro = false;
				rodada.respondidos[id] = janelasDeHoje(await this.d.trimble.historico(celula, agora));
			}
		} catch (e) {
			const primeira = falhas?.primeira ?? agora;
			this.falhasDaTrimble = {
				marco,
				primeira,
				ultima: agora
			};
			this.semTrimbleDesde ??= agora;
			this.registrar(`Trimble: ${mensagemDe$1(e)}`);
			if (agora - primeira >= INSISTENCIA_NA_TRIMBLE_MS) {
				const desde = this.semTrimbleDesde;
				const quando = chaveData(desde) === dia ? horaDe(desde) : `${dataCurta(desde)} ${horaDe(desde)}`;
				await this.avisar("trimble", `Sem dados da Trimble desde ${quando}: alertas parados até ela voltar`);
			}
			return;
		}
		this.janelas = {
			calculadoEm: agora,
			porCelula: rodada.respondidos
		};
		this.fazendas = rodada.fazendas;
		this.rodada = null;
		this.falhasDaTrimble = null;
		this.semTrimbleDesde = null;
		this.registrar(`janelas calculadas para ${rodada.quadrados.size} quadrado(s)`);
		await this.avisar("trimble", null);
	}
	/** Evita ler contatos e envios (o banco) a cada minuto do dia: só quando há um evento a considerar. */
	algoNaHora(agora, janelas) {
		if (this.pedidoDeResumo === chaveData(agora)) return true;
		if (eventosFixosNaHora(agora).length) return true;
		return Object.values(janelas.porCelula).some((js) => janelaDoAntes(js, agora) !== null);
	}
	async enviarEventos(agora, janelas) {
		const fazendas = this.fazendas ?? [];
		const [contatos, deOntem, deHoje] = await Promise.all([
			this.d.banco.contatos(),
			this.d.banco.chavesDoDia(chaveData(agora - DIA_MS)),
			this.d.banco.chavesDoDia(chaveData(agora))
		]);
		if (!this.semeado) {
			for (const r of deHoje) this.contador.contar(r.contatoId);
			this.semeado = true;
		}
		const jaReservadas = [...deOntem, ...deHoje];
		await this.reconciliarPausados(contatos);
		const aptos = contatos.filter((c) => c.ativo && c.alertaJanela && c.confirmadoEm).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
		const comPedido = this.pedidoDeResumo === chaveData(agora);
		const fixos = eventosFixosNaHora(agora);
		const tipos = [
			...comPedido && !fixos.includes("resumo-07") ? ["resumo-07"] : [],
			...fixos,
			"antes"
		];
		let tentouAlgum = false;
		for (const tipo of tipos) {
			const chave = tipo === "antes" ? chaveDoAntes(agora) : chaveEvento(agora, tipo);
			const doPedido = comPedido && tipo === "resumo-07";
			const contagem = {
				enviados: 0,
				jaTinham: 0,
				semJanela: 0
			};
			for (const contato of aptos) {
				if (jaReservadas.some((r) => r.contatoId === contato.id && r.chave === chave)) {
					contagem.jaTinham += 1;
					continue;
				}
				let pronto = await this.preparar(tipo, contato, fazendas, janelas);
				if (pronto === "parar") return;
				if (pronto === null) {
					if (this.semTextoParaOContato(contato)) contagem.semJanela += 1;
					continue;
				}
				if (tentouAlgum && !this.d.ensaio) {
					await this.d.dormir(pausaEntrePessoas());
					if (tipo === "resumo-07" && chaveData(this.d.agora()) !== chaveData(agora)) return;
					pronto = await this.preparar(tipo, contato, fazendas, janelas);
					if (pronto === "parar") return;
					if (pronto === null) {
						if (this.semTextoParaOContato(contato)) contagem.semJanela += 1;
						continue;
					}
				}
				if (this.d.ensaio) this.ensaiar(contato, tipo, chave, pronto, jaReservadas);
				else if (await this.mandar(contato, tipo, chave, pronto, jaReservadas)) {
					tentouAlgum = true;
					if (jaReservadas.some((r) => r.contatoId === contato.id && r.chave === chave && r.situacao === "enviado")) contagem.enviados += 1;
				}
			}
			if (doPedido) {
				this.pedidoDeResumo = null;
				this.registrar(`resumo de hoje (a pedido): ${contagem.enviados} enviado(s), ${contagem.jaTinham} já tinham recebido, ${contagem.semJanela} sem janela hoje`);
			}
		}
	}
	/** Depois de `preparar` devolver `null`: o contato não tem texto (sem janela) ou foi barrado por outro motivo (SAIR, teto dele)? */
	semTextoParaOContato(contato) {
		return !this.estaPausado(contato) && this.contador.podeAlerta(contato.id);
	}
	/**
	* Quem mandou SAIR e o banco ainda mostra ativo: tenta gravar a pausa de novo (uma vez por volta).
	* Quem o banco já mostra inativo: a marca cumpriu o papel e sai.
	*/
	async reconciliarPausados(contatos) {
		for (const c of contatos) {
			const numero = chaveDoNumero(c.telefone);
			if (!numero || !this.pausados.has(numero)) continue;
			if (!c.ativo) {
				this.pausados.delete(numero);
				continue;
			}
			try {
				await this.d.banco.pausar(c.id);
			} catch (e) {
				this.registrar(`${mascarar(c.telefone)}: não gravei a pausa: ${mensagemDe$1(e)}`);
			}
		}
	}
	estaPausado(contato) {
		const numero = chaveDoNumero(contato.telefone);
		return numero !== null && this.pausados.has(numero);
	}
	/** O texto a mandar a este contato agora; `null` = nada para ele; `'parar'` = nada mais sai nesta volta. */
	async preparar(tipo, contato, fazendas, janelas) {
		if (!this.d.ensaio && (!this.d.whatsapp.conectado || this.bloqueio() !== null)) return "parar";
		if (this.estaPausado(contato)) return null;
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
		this.registrar(`${ERRO_TETO_DO_DIA}: nada mais sai hoje`);
		await this.avisar("teto", ERRO_TETO_DO_DIA);
	}
	/** Espera a chamada ao WhatsApp, no máximo `PRAZO_DO_WHATSAPP_MS` (o relógio é o `dormir` injetado). */
	async comPrazo(chamada) {
		chamada.catch(() => {});
		const r = await Promise.race([chamada, this.d.dormir(PRAZO_DO_WHATSAPP_MS).then(() => ESTOUROU)]);
		if (r === ESTOUROU) throw new PrazoEstourado();
		return r;
	}
	/** Todo envio (alerta ou resposta) passa por aqui: é onde a sequência de recusas do WhatsApp é contada. */
	async enviar(jid, texto) {
		if (!this.recusaDesdeOUltimoEnvio) this.recusasSeguidas = 0;
		this.recusaDesdeOUltimoEnvio = false;
		await this.comPrazo(this.d.whatsapp.enviar(jid, texto));
	}
	numerosSemWhatsapp() {
		const dia = chaveData(this.d.agora());
		if (this.semWhatsapp.dia !== dia) this.semWhatsapp = {
			dia,
			telefones: /* @__PURE__ */ new Set()
		};
		return this.semWhatsapp.telefones;
	}
	/** `true` se tentou mandar (deu certo ou não): é o que pede a pausa antes da próxima pessoa. */
	async mandar(contato, tipo, chave, texto, jaReservadas) {
		const quem = mascarar(contato.telefone);
		const hoje = chaveData(this.d.agora());
		const comSair = !jaReservadas.some((r) => r.contatoId === contato.id && r.situacao === "enviado" && r.chave.startsWith(`${hoje}:`));
		let jid = contato.jid;
		let entrada;
		try {
			if (!jid) {
				const semWhatsapp = this.numerosSemWhatsapp();
				let achado = null;
				let falhou = null;
				if (semWhatsapp.has(contato.telefone)) falhou = ERRO_SEM_WHATSAPP;
				else {
					try {
						achado = await this.comPrazo(this.d.whatsapp.resolverJid(contato.telefone));
					} catch (e) {
						if (!(e instanceof PrazoEstourado)) throw e;
						falhou = e.message;
					}
					if (achado === null && falhou === null) {
						semWhatsapp.add(contato.telefone);
						falhou = ERRO_SEM_WHATSAPP;
					}
				}
				if (falhou !== null || achado === null) {
					const erro = falhou ?? ERRO_SEM_WHATSAPP;
					if (await this.d.banco.reservarEnvio(contato.id, chave, tipo)) {
						jaReservadas.push({
							contatoId: contato.id,
							chave,
							situacao: "falhou"
						});
						await this.fechar(contato.id, chave, quem, "falhou", erro);
						this.registrar(`${quem}: ${erro}`);
					}
					return false;
				}
				jid = achado;
				try {
					await this.d.banco.guardarJid(contato.id, jid);
				} catch (e) {
					this.registrar(`${quem}: não guardei o endereço: ${mensagemDe$1(e)}`);
				}
			}
			const reservou = await this.d.banco.reservarEnvio(contato.id, chave, tipo);
			entrada = {
				contatoId: contato.id,
				chave,
				situacao: "enviando"
			};
			jaReservadas.push(entrada);
			if (!reservou) return false;
		} catch (e) {
			this.registrar(`${quem}: não mandei ${tipo}: ${mensagemDe$1(e)}`);
			return false;
		}
		const impedimento = this.estaPausado(contato) ? ERRO_PEDIU_PARA_SAIR : this.bloqueio();
		if (impedimento !== null) {
			entrada.situacao = "pulado";
			this.registrar(`${quem}: ${tipo} não enviado: ${impedimento}`);
			await this.fechar(contato.id, chave, quem, "pulado", impedimento);
			return false;
		}
		try {
			await this.enviar(jid, montarMensagem(tipo, contato, texto, this.d.agora(), comSair));
		} catch (e) {
			this.registrar(`${quem}: falha ao enviar ${tipo}: ${mensagemDe$1(e)}`);
			entrada.situacao = "falhou";
			await this.fechar(contato.id, chave, quem, "falhou", mensagemDe$1(e));
			return true;
		}
		this.contador.contar(contato.id);
		entrada.situacao = "enviado";
		this.registrar(`enviado ${tipo} a ${quem}`);
		await this.fechar(contato.id, chave, quem, "enviado");
		try {
			await this.d.banco.gravarEstado({
				conectado: this.d.whatsapp.conectado,
				ultimoEnvioEm: new Date(this.d.agora()).toISOString()
			});
		} catch (e) {
			this.registrar(`não gravei o último envio: ${mensagemDe$1(e)}`);
		}
		return true;
	}
	async fechar(contatoId, chave, quem, situacao, erro) {
		try {
			await this.d.banco.fecharEnvio(contatoId, chave, situacao, erro === void 0 ? void 0 : semNumeros(erro));
		} catch (e) {
			this.registrar(`${quem}: não fechei o envio: ${mensagemDe$1(e)}`);
		}
	}
	ensaiar(contato, tipo, chave, texto, jaReservadas) {
		const marca = `${contato.id}|${chave}`;
		if (this.ensaiados.has(marca)) return;
		const prefixoDoDia = `${contato.id}|${chave.split(":")[0]}:`;
		const comSair = !jaReservadas.some((r) => r.contatoId === contato.id && r.situacao === "enviado") && ![...this.ensaiados].some((m) => m.startsWith(prefixoDoDia));
		this.ensaiados.add(marca);
		const mensagem = montarMensagem(tipo, contato, texto, this.d.agora(), comSair).replaceAll("\n", " / ");
		this.registrar(`ensaio: enviaria ${tipo} a ${mascarar(contato.telefone)}: ${mensagem}`);
	}
	/**
	* Só no ensaio, uma vez: por que cada contato NÃO receberia, e as fazendas que nenhum contato
	* alcança (a não ser os de "todas"). É o que explica um ensaio que não mostra ninguém.
	*/
	async explicarEnsaio(janelas) {
		const contatos = await this.d.banco.contatos();
		this.ensaioExplicado = true;
		const fazendas = this.fazendas ?? [];
		const porNome = (a, b) => a.localeCompare(b, "pt-BR");
		for (const c of [...contatos].sort((a, b) => porNome(a.nome, b.nome))) {
			const motivos = [];
			if (!c.ativo) motivos.push("inativo");
			if (!c.alertaJanela) motivos.push("sem Janela de risco");
			if (!c.confirmadoEm) motivos.push("aguardando ATIVAR");
			const temJanela = fazendasDoContato(c, fazendas).some((f) => (janelas.porCelula[f.celulaId] ?? []).length > 0);
			if (!motivos.length && !temJanela) motivos.push("sem janela nas fazendas dele hoje");
			if (motivos.length) this.registrar(`ensaio: ${mascarar(c.telefone)} não receberia: ${motivos.join(", ")}`);
		}
		const semVinculo = fazendas.filter((f) => f.celulaId && f.coaId == null).map((f) => f.nome).sort(porNome);
		if (semVinculo.length) this.registrar(`ensaio: Fazendas sem vínculo com o COA WEB (não entram em contato nenhum que não seja "todas"): ${semVinculo.join(", ")}`);
	}
	/** Resposta a ATIVAR/SAIR: no máximo 2 por pessoa por dia, respeita o teto do dia e conta nele. */
	async responder(contato, jid, quem, texto) {
		const dia = chaveData(this.d.agora());
		const anterior = this.respostas.get(contato.id);
		const feitas = anterior && anterior.dia === dia ? anterior.n : 0;
		if (feitas >= MAX_RESPOSTAS_POR_PESSOA_POR_DIA) {
			this.registrar(`${quem}: limite de respostas do dia, não respondi`);
			return;
		}
		if (this.bloqueio() !== null) {
			this.registrar(`${quem}: ${this.bloqueio()}, não respondi`);
			return;
		}
		if (!this.contador.podeMensagem()) {
			await this.avisarTetoDoDia();
			return;
		}
		this.respostas.set(contato.id, {
			dia,
			n: feitas + 1
		});
		if (this.ultimaResposta) {
			const passou = this.d.agora() - this.ultimaResposta.em;
			if (passou >= 0 && passou < this.ultimaResposta.pausa) {
				await this.d.dormir(this.ultimaResposta.pausa - passou);
				if (this.bloqueio() !== null) return;
			}
		}
		try {
			await this.enviar(jid, texto);
			this.contador.contar(null);
			this.ultimaResposta = {
				em: this.d.agora(),
				pausa: pausaEntreRespostas()
			};
		} catch (e) {
			this.registrar(`${quem}: não consegui responder: ${mensagemDe$1(e)}`);
		}
	}
};
//#endregion
//#region src/servidor/whatsapp.ts
/** Conexão do WhatsApp do serviço (Baileys). É o único arquivo que importa a biblioteca. */
var ESPERA_MINIMA = 5e3;
var ESPERA_MAXIMA = 3e5;
/** Conexão que abre e cai logo em seguida não zera a espera: só a que ficou aberta este tempo. */
var ABERTA_PARA_ZERAR_A_ESPERA_MS = 3e5;
var HORA_MS = 36e5;
/** Mais quedas que isto dentro de uma hora: reconectar em laço só piora a reputação do número. */
var MAXIMO_DE_QUEDAS_POR_HORA = 10;
/** Com quedas demais o serviço espera isto e tenta de novo sozinho: uma queda de internet da VM não pede ninguém. */
var PAUSA_POR_MUITAS_QUEDAS_MS = HORA_MS;
var MOTIVO_MUITAS_QUEDAS = "muitas quedas seguidas: nova tentativa em 1 hora";
/** Na biblioteca o 500 é o código-coringa (erro de WebSocket ou `stream:error` sem código), não só "sessão inválida". */
var CODIGO_ERRO_DE_SESSAO = DisconnectReason.badSession;
var MOTIVO_ERRO_DE_SESSAO = "erro de sessão: nova tentativa em 1 hora";
/** A fila de quando o serviço estava fora do ar: mensagem mais velha que isto não vale mais como pedido (exceto o SAIR). */
var VALIDADE_DA_FILA_MS = 48 * HORA_MS;
var PRAZO_DA_VERSAO_MS = 1e4;
/** A consulta ao mapa de endereços `@lid` é local; se pendurar, não pode travar as mensagens que vêm depois. */
var PRAZO_DO_MAPA_MS = 5e3;
/** Quantas mensagens enviadas ficam lembradas para reconhecer uma recusa que chega depois. */
var ENVIADAS_LEMBRADAS = 200;
var MOTIVO_SEM_RECONEXAO = {
	[DisconnectReason.loggedOut]: "sessão encerrada no celular",
	[DisconnectReason.connectionReplaced]: "sessão em uso em outro lugar",
	[DisconnectReason.forbidden]: "acesso recusado pelo WhatsApp",
	[DisconnectReason.multideviceMismatch]: "versão do aparelho incompatível"
};
var textoDoErro = (e) => e instanceof Error ? e.message : "erro";
/** O texto da mensagem; mensagem temporária (efêmera) ou de visualização única embrulha o conteúdo. */
function textoDe(m) {
	const conteudo = normalizeMessageContent(m.message);
	return (conteudo?.conversation ?? conteudo?.extendedTextMessage?.text) || null;
}
/** Só o texto de uma mensagem de conversa individual vinda de outra pessoa; o resto vira `null`. */
function lerRecebida(m) {
	if (m.key.fromMe) return null;
	const bruto = m.key.remoteJid ?? "";
	const jid = bruto.endsWith("@lid") ? m.key.remoteJidAlt ?? "" : bruto;
	if (!jid || chaveDoNumero(jid) === null) return null;
	const texto = textoDe(m);
	const segundos = segundosDe(m.messageTimestamp);
	return texto ? {
		jid,
		texto,
		em: segundos === null ? null : segundos * 1e3
	} : null;
}
/** Remetente em `@lid` sem o telefone junto: só o mapa da biblioteca diz quem é. */
function precisaDoMapa(m) {
	return !m.key.fromMe && (m.key.remoteJid ?? "").endsWith("@lid") && !m.key.remoteJidAlt && textoDe(m) !== null;
}
function segundosDe(carimbo) {
	const valor = typeof carimbo === "number" ? carimbo : typeof carimbo?.toNumber === "function" ? carimbo.toNumber() : NaN;
	return Number.isFinite(valor) && valor > 0 ? valor : null;
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
/** A versão mais nova do protocolo, com prazo: sem resposta (ou com falha), a biblioteca usa a que ela traz. */
async function versaoDoProtocolo(buscar, dormir) {
	try {
		const busca = buscar();
		busca.catch(() => {});
		const resposta = await Promise.race([busca, dormir(PRAZO_DA_VERSAO_MS).then(() => void 0)]);
		return resposta && resposta.isLatest !== false ? resposta.version : void 0;
	} catch {
		return;
	}
}
async function conectarWhatsapp(opcoes) {
	const dep = opcoes.dependencias;
	const criarSocket = dep?.criarSocket ?? ((config) => makeWASocket(config));
	const estadoDaSessao = dep?.estadoDaSessao ?? useMultiFileAuthState;
	const dormir = dep?.dormir ?? dormirDeVerdade;
	const agora = dep?.agora ?? Date.now;
	const buscarVersao = dep ? dep.buscarVersao : fetchLatestBaileysVersion;
	const { state, saveCreds } = await estadoDaSessao(opcoes.pastaSessao);
	const version = buscarVersao ? await versaoDoProtocolo(buscarVersao, dormir) : void 0;
	let socket;
	let conectado = false;
	let precisaParear = false;
	let encerrado = false;
	let reconectando = false;
	/** Dentro da espera de 1 hora (muitas quedas, ou erro de sessão): um novo `close` não é queda nenhuma. */
	let emPausa = false;
	/** Acorda a espera da reconexão antes da hora (só `encerrar()` chama). */
	let acordarEspera = null;
	let espera = ESPERA_MINIMA;
	let abertaEm = null;
	let quedas = [];
	let restritoAte = null;
	/** Id de cada mensagem enviada → para onde foi (a recusa chega depois, com o endereço que o servidor quiser). */
	const enviadas = /* @__PURE__ */ new Map();
	/** As recebidas à espera do mapa de endereços; vazia, a mensagem é entregue na hora. */
	let filaDeRecebidas = null;
	const numeroParaCodigo = opcoes.numeroParaCodigo?.replace(/\D/g, "");
	async function gravarSessao() {
		try {
			await saveCreds();
		} catch (e) {
			console.log(`[whatsapp] falha ao gravar a sessão: ${textoDoErro(e)}`);
		}
	}
	const falhouAoReceber = (e) => console.log(`[whatsapp] falha ao tratar uma mensagem recebida: ${e instanceof Error ? e.name : "erro"}`);
	const entregar = (recebida) => {
		if (recebida) Promise.resolve(opcoes.aoReceber(recebida)).catch(falhouAoReceber);
	};
	/** Lê a mensagem e a entrega; devolve uma promessa só quando precisou perguntar ao mapa de endereços. */
	function receber(s, m) {
		if (!precisaDoMapa(m)) return entregar(lerRecebida(m));
		const lid = m.key.remoteJid;
		const consulta = Promise.resolve(s.signalRepository?.lidMapping?.getPNForLID(lid) ?? null);
		consulta.catch(() => {});
		return Promise.race([consulta, dormir(PRAZO_DO_MAPA_MS).then(() => null)]).then((telefone) => {
			if (telefone) entregar(lerRecebida({
				...m,
				key: {
					...m.key,
					remoteJidAlt: jidNormalizedUser(telefone)
				}
			}));
		});
	}
	/** Uma por vez e na ordem de chegada: um SAIR não pode passar na frente (nem ficar atrás) do ATIVAR da mesma pessoa. */
	function enfileirar(s, m) {
		const passo = () => {
			try {
				return receber(s, m);
			} catch (erro) {
				falhouAoReceber(erro);
			}
		};
		const pendente = filaDeRecebidas ? filaDeRecebidas.then(passo) : passo();
		if (!pendente) return;
		const vez = pendente.catch(falhouAoReceber).finally(() => {
			if (filaDeRecebidas === vez) filaDeRecebidas = null;
		});
		filaDeRecebidas = vez;
	}
	/** Mensagem de quando o serviço estava fora do ar: só a de outra pessoa; com menos de 48 h, ou um SAIR (de qualquer idade, mesmo sem carimbo). */
	function valeNaFila(m) {
		if (m.key.fromMe) return false;
		const texto = textoDe(m);
		if (texto !== null && lerComando(texto) === "sair") return true;
		const segundos = segundosDe(m.messageTimestamp);
		return segundos !== null && agora() - segundos * 1e3 < VALIDADE_DA_FILA_MS;
	}
	function tratarRestricao(r) {
		const fim = r.timeEnforcementEnds == null ? NaN : new Date(r.timeEnforcementEnds).getTime();
		const novo = r.isActive ? Number.isFinite(fim) ? fim : Infinity : null;
		if (novo === restritoAte) return;
		restritoAte = novo;
		opcoes.aoRestringir?.(novo, novo === null ? "restrição retirada" : r.enforcementType ?? "");
	}
	function abrir() {
		const s = criarSocket({
			auth: state,
			...version ? { version } : {},
			browser: Browsers.ubuntu("Chrome"),
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
			if (u.reachoutTimeLock) tratarRestricao(u.reachoutTimeLock);
			if (u.connection === "open") {
				conectado = true;
				precisaParear = false;
				abertaEm = agora();
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
				if (emPausa) return;
				if (!reconectando) {
					if (codigo === CODIGO_ERRO_DE_SESSAO) {
						pausarPorUmaHora(MOTIVO_ERRO_DE_SESSAO);
						return;
					}
					const quando = agora();
					if (abertaEm !== null && quando - abertaEm >= ABERTA_PARA_ZERAR_A_ESPERA_MS) espera = ESPERA_MINIMA;
					quedas = [...quedas.filter((t) => quando - t < HORA_MS), quando];
					if (quedas.length > MAXIMO_DE_QUEDAS_POR_HORA) {
						pausarPorUmaHora(MOTIVO_MUITAS_QUEDAS);
						return;
					}
				}
				abertaEm = null;
				opcoes.aoMudarConexao(false, `conexão perdida${codigo ? ` (${codigo})` : ""}`);
				reconectar();
			}
		}));
		s.ev.on("messages.upsert", ((e) => {
			if (!atual()) return;
			if (e.type !== "notify" && e.type !== "append") return;
			for (const m of e.messages) {
				if (e.type === "append" && !valeNaFila(m)) continue;
				enfileirar(s, m);
			}
		}));
		s.ev.on("messages.update", ((atualizacoes) => {
			if (!atual()) return;
			for (const a of atualizacoes) {
				const id = a.key?.id;
				if (!id || a.update?.status !== WAMessageStatus.ERROR) continue;
				const jid = enviadas.get(id);
				if (!jid) continue;
				enviadas.delete(id);
				try {
					opcoes.aoFalharEntrega?.(jid);
				} catch (erro) {
					console.log(`[whatsapp] falha ao tratar uma recusa de mensagem: ${erro instanceof Error ? erro.name : "erro"}`);
				}
			}
		}));
	}
	/** Avisa e espera 1 hora antes de tentar de novo; depois da pausa a contagem de quedas e a espera recomeçam do zero. */
	function pausarPorUmaHora(motivo) {
		abertaEm = null;
		quedas = [];
		espera = ESPERA_MINIMA;
		opcoes.aoMudarConexao(false, motivo);
		reconectar(PAUSA_POR_MUITAS_QUEDAS_MS);
	}
	/** Espera `ms`. `encerrar()` acorda a espera, e fora dos testes o timer é solto (um de 1 hora seguraria o processo). */
	function esperar(ms) {
		return new Promise((resolver) => {
			let timer;
			const fim = () => {
				clearTimeout(timer);
				if (acordarEspera === fim) acordarEspera = null;
				resolver();
			};
			acordarEspera = fim;
			if (dep?.dormir) dormir(ms).then(fim, fim);
			else timer = setTimeout(fim, ms);
		});
	}
	async function reconectar(primeiraEspera) {
		if (reconectando) return;
		reconectando = true;
		try {
			while (!encerrado) {
				let ms = espera;
				if (primeiraEspera !== void 0) {
					ms = primeiraEspera;
					primeiraEspera = void 0;
					emPausa = true;
				} else espera = Math.min(espera * 2, ESPERA_MAXIMA);
				console.log(`[whatsapp] nova tentativa de conexão em ${Math.round(ms / 1e3)} s`);
				await esperar(ms);
				emPausa = false;
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
			emPausa = false;
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
		get restritoAte() {
			return restritoAte !== null && restritoAte > agora() ? restritoAte : null;
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
			const id = (await s.sendMessage(jid, { text: texto }))?.key?.id ?? null;
			if (id) {
				enviadas.set(id, jid);
				if (enviadas.size > ENVIADAS_LEMBRADAS) enviadas.delete(enviadas.keys().next().value);
			}
			return id;
		},
		async resolverJid(telefone) {
			if (!conectado || !socket) throw new Error("WhatsApp desconectado");
			const primeiro = (await socket.onWhatsApp(telefone.replace(/\D/g, "")))?.[0];
			return primeiro?.exists ? primeiro.jid : null;
		},
		async encerrar() {
			encerrado = true;
			conectado = false;
			acordarEspera?.();
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
/** Parando, o serviço espera a volta em curso (um envio já reservado tem de sair) no máximo isto. */
var LIMITE_DA_VOLTA_MS = 2e4;
/** Depois da volta: fechar a conexão e gravar o estado não podem segurar a parada para sempre. */
var LIMITE_PARA_ENCERRAR_MS = 15e3;
var PAUSA_DA_TRIMBLE_NO_ENSAIO_MS = 2e3;
var AINDA_NAO_PAREADO = "Ainda não pareado: rode o pareamento (ver LEIA-ME).";
var SESSAO_ENCERRADA = "Sessão encerrada: é preciso parear de novo (ver LEIA-ME).";
/** O motivo que o `whatsapp.ts` dá à única queda que se resolve pareando de novo. */
var MOTIVO_SESSAO_ENCERRADA = "sessão encerrada no celular";
var FORMATO_DO_NUMERO = /^55[1-9][1-9]\d{8,9}$/;
/** O número que o guia e os testes usam de exemplo; a faixa recusada é ele com qualquer último dígito. */
var NUMERO_DE_EXEMPLO = "5565999990001";
/** Quem cola o comando do guia sem trocar o número não pode mandar mensagem (nem pedir código) para um estranho. */
function conferirNumero(numero) {
	if (numero.slice(0, -1) === NUMERO_DE_EXEMPLO.slice(0, -1)) throw new Error("Esse é o número de exemplo: troque pelo número de verdade.");
	if (!FORMATO_DO_NUMERO.test(numero)) throw new Error("Número fora do formato: use só dígitos, com 55 e DDD na frente.");
	return numero;
}
function lerArgumentos(argv) {
	const [primeiro, segundo, ...resto] = argv;
	const invalido = () => /* @__PURE__ */ new Error(`Argumento não reconhecido. Aceitos: ${ACEITOS}.`);
	if (primeiro === void 0) return { modo: "servico" };
	if (resto.length > 0) throw invalido();
	if (primeiro === "--parear") return segundo === void 0 ? { modo: "parear" } : {
		modo: "parear",
		numero: conferirNumero(segundo)
	};
	if (primeiro === "--teste") {
		if (segundo === void 0) throw new Error("Falta o número para o teste: --teste <número>.");
		return {
			modo: "teste",
			numero: conferirNumero(segundo)
		};
	}
	if (primeiro === "--ensaio" && segundo === void 0) return { modo: "ensaio" };
	throw invalido();
}
var lerVariavel = (env, nome, formato, foraDoFormato) => {
	const valor = (env[nome] ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
	if (!valor) throw new Error(`Falta ${nome} no arquivo de ambiente (/home/locks-sat/.locks-sat-whatsapp.env).`);
	if (!formato.test(valor)) throw new Error(foraDoFormato);
	return valor;
};
/** Pasta da sessão do WhatsApp: o pareamento e o teste só precisam dela, não do Supabase. */
var pastaDaSessao = (env) => env.LOCKS_SAT_SESSAO?.trim() || "./sessao";
function lerAmbiente(env) {
	return {
		url: lerVariavel(env, "SUPABASE_URL", /^https:\/\/[a-z0-9.-]+$/, "SUPABASE_URL não parece um endereço https://… do Supabase"),
		chave: lerVariavel(env, "SUPABASE_SERVICE_ROLE_KEY", /^[A-Za-z0-9._-]{20,}$/, "SUPABASE_SERVICE_ROLE_KEY tem caracteres que uma chave não tem"),
		pastaSessao: pastaDaSessao(env)
	};
}
/**
* Já existe sessão pareada? Sem ela, conectar só geraria QR que ninguém vê. Existir o `creds.json` não basta:
* a biblioteca o grava assim que começa, e o pareamento por código põe nele o `me` (e depois o `registered`)
* antes de o celular aceitar. Conta registrada é a que tem `account`, que só chega junto do aceite; o
* `registered` não serve de prova porque fica `false` para sempre em quem pareou por QR.
*/
function sessaoPareada(pastaSessao) {
	try {
		const creds = JSON.parse(readFileSync(join(pastaSessao, "creds.json"), "utf8"));
		return typeof creds?.me?.id === "string" && creds.me.id !== "" && typeof creds.account === "object" && creds.account !== null;
	} catch {
		return false;
	}
}
/**
* Sobra de um pareamento que não terminou: o pareamento por código grava a sessão antes de o celular
* aceitar, e com ela a tentativa seguinte entraria como uma conta que não existe e seria recusada.
* Sessão pareada de verdade nunca é tocada. Devolve se apagou alguma coisa.
*/
function limparPareamentoIncompleto(pastaSessao) {
	if (sessaoPareada(pastaSessao)) return false;
	let apagou = false;
	try {
		for (const nome of readdirSync(pastaSessao)) {
			rmSync(join(pastaSessao, nome), {
				recursive: true,
				force: true
			});
			apagou = true;
		}
	} catch {}
	return apagou;
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
/** Para erro que ninguém previu: a mensagem pode trazer qualquer coisa, o nome não. */
var nomeDoErro = (e) => e instanceof Error ? e.name : "erro";
/** O que dizer de uma queda em que a conexão não é tentada de novo: só a sessão encerrada pede novo pareamento. */
var quedaSemVolta = (motivo, complemento = "") => !motivo || motivo === MOTIVO_SESSAO_ENCERRADA ? SESSAO_ENCERRADA : `O WhatsApp fechou a conexão (${motivo})${complemento}: ver "Se algo der errado" no LEIA-ME.`;
/** O fuso que o processo realmente usa (vale também se vier do sistema, não só da variável TZ). */
var fusoDoProcesso = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
function exigirFuso(fuso) {
	if (!fusoCerto(fuso)) throw new Error(`O fuso do processo precisa ser ${FUSO} (TZ=${FUSO}): as janelas e os horários dos alertas dependem dele. Hoje: ${fuso}.`);
}
/** O serviço de verdade: fica ligado, olha o relógio a cada minuto e atende ATIVAR/SAIR. Não termina sozinho. */
async function ligarServico(p) {
	let whatsapp = null;
	let conectando = false;
	let parando = false;
	let relogio;
	let voltaEmCurso = null;
	/** As esperas do Servico que a parada interrompe (a pausa entre duas pessoas chega a 45 s). */
	const acordar = /* @__PURE__ */ new Set();
	const dormirDoServico = (ms) => {
		if (ms === 6e4 || ms === 1e4) return dormir(ms);
		if (parando) return Promise.resolve();
		return new Promise((resolver) => {
			const fim = () => {
				clearTimeout(prazo);
				acordar.delete(fim);
				resolver();
			};
			const prazo = setTimeout(fim, ms);
			acordar.add(fim);
		});
	};
	const ponte = {
		get conectado() {
			return !parando && (whatsapp?.conectado ?? false);
		},
		get precisaParear() {
			return whatsapp?.precisaParear ?? false;
		},
		enviar: (jid, texto) => whatsapp ? whatsapp.enviar(jid, texto) : Promise.reject(/* @__PURE__ */ new Error("WhatsApp desconectado")),
		resolverJid: (telefone) => whatsapp ? whatsapp.resolverJid(telefone) : Promise.reject(/* @__PURE__ */ new Error("WhatsApp desconectado"))
	};
	const s = new Servico({
		banco: p.banco,
		trimble: { historico: (celula, agora) => parando ? Promise.reject(/* @__PURE__ */ new Error("serviço parando")) : p.trimble.historico(celula, agora) },
		whatsapp: ponte,
		agora: () => Date.now(),
		dormir: dormirDoServico,
		registrar: p.registrar
	});
	async function conectar() {
		conectando = true;
		try {
			const nova = await p.conectar({
				pastaSessao: p.pastaSessao,
				aoReceber: async (m) => {
					try {
						await s.recebida(m);
					} catch (e) {
						p.registrar(`falha ao tratar mensagem: ${mensagemDe(e)}`);
					}
				},
				aoMudarConexao: async (conectado, motivo) => {
					if (parando) return;
					if (ponte.precisaParear) p.registrar(quedaSemVolta(motivo, " e o serviço não tenta de novo sozinho"));
					try {
						await s.conexao(conectado, motivo);
					} catch (e) {
						p.registrar(`falha ao tratar a conexão: ${mensagemDe(e)}`);
					}
				},
				aoRestringir: (ate, motivo) => {
					s.restricao(ate, motivo).catch((e) => p.registrar(`falha ao tratar a restrição: ${mensagemDe(e)}`));
				},
				aoFalharEntrega: (jid) => {
					s.falhaDeEntrega(jid).catch((e) => p.registrar(`falha ao tratar a recusa: ${mensagemDe(e)}`));
				}
			});
			if (parando) await nova.encerrar();
			else whatsapp = nova;
		} finally {
			conectando = false;
		}
	}
	const parar = (sinal) => {
		if (parando) {
			p.registrar(`${sinal} de novo: saindo sem esperar`);
			p.sair(1);
			return;
		}
		parando = true;
		clearInterval(relogio);
		p.registrar(`${sinal} recebido: parando o serviço`);
		for (const fim of [...acordar]) fim();
		(async () => {
			if (voltaEmCurso) await Promise.race([voltaEmCurso, dormir(LIMITE_DA_VOLTA_MS)]);
			const teto = setTimeout(() => p.sair(0), LIMITE_PARA_ENCERRAR_MS);
			teto.unref();
			try {
				await s.aguardarGravacoes(PRAZO_DAS_GRAVACOES_MS);
			} catch (e) {
				p.registrar(`falha ao esperar as gravações: ${mensagemDe(e)}`);
			}
			try {
				await whatsapp?.encerrar();
			} catch (e) {
				p.registrar(`falha ao encerrar a conexão: ${mensagemDe(e)}`);
			}
			try {
				await s.conexao(false, "serviço parado");
			} catch (e) {
				p.registrar(`não gravei o estado: ${mensagemDe(e)}`);
			}
			clearTimeout(teto);
			p.sair(0);
		})();
	};
	/** Uma volta do serviço, pela mesma função do relógio de um minuto e do SIGUSR2: nunca duas ao mesmo tempo. */
	const dispararVolta = () => {
		if (voltaEmCurso) return;
		voltaEmCurso = s.volta().catch((e) => p.registrar(`falha na volta: ${mensagemDe(e)}`)).finally(() => {
			voltaEmCurso = null;
		});
	};
	p.processo.on("SIGTERM", () => parar("SIGTERM"));
	p.processo.on("SIGINT", () => parar("SIGINT"));
	p.processo.on("SIGUSR2", () => {
		if (parando) return;
		s.pedirResumoDeHoje();
		dispararVolta();
	});
	p.processo.on("unhandledRejection", (e) => p.registrar(`erro não tratado: ${nomeDoErro(e)}`));
	p.processo.on("uncaughtException", (e) => {
		p.registrar(`erro não tratado: ${nomeDoErro(e)}`);
		p.sair(1);
	});
	if (p.pareado()) await conectar();
	else {
		p.registrar(AINDA_NAO_PAREADO);
		await s.conexao(false, "ainda não pareado");
	}
	if (parando) return;
	relogio = setInterval(() => {
		if (!whatsapp && !conectando && p.pareado()) conectar().catch((e) => p.registrar(`falha ao conectar: ${mensagemDe(e)}`));
		dispararVolta();
	}, VOLTA_MS);
	p.registrar("serviço ligado");
}
async function servico(env) {
	exigirFuso(fusoDoProcesso());
	const { url, chave, pastaSessao } = lerAmbiente(env);
	await ligarServico({
		banco: criarBanco({
			url,
			chave
		}),
		trimble: criarTrimble(),
		conectar: conectarWhatsapp,
		pastaSessao,
		pareado: () => sessaoPareada(pastaSessao),
		registrar,
		sair: (codigo) => process.exit(codigo),
		processo: process
	});
}
/**
* O desenhador do QR no terminal. A biblioteca lê `this.error` dentro de `generate`: chamada solta
* (`const generate = lib.generate`), ela quebra com "bad rs block" — foi o que aconteceu no primeiro
* pareamento na VM. Por isso a chamada é sempre pelo objeto.
*/
async function desenhadorDeQr() {
	const modulo = await import("qrcode-terminal");
	const biblioteca = modulo.default ?? modulo;
	return (qr) => biblioteca.generate(qr, { small: true });
}
/** Mostra o QR (ou o código de 8 dígitos, se vier o número) até o celular aceitar; então escreve "Pareado.". */
async function parear(env, numero) {
	const desenharQr = await desenhadorDeQr();
	if (limparPareamentoIncompleto(pastaDaSessao(env))) console.log("Apaguei a sobra de uma tentativa de pareamento que não terminou.");
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
			desenharQr(qr);
		},
		aoReceberCodigo: (codigo) => {
			const legivel = codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
			console.log(`Código de pareamento: ${legivel}`);
			console.log("No celular: Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone, e digite o código.");
		},
		aoMudarConexao: (conectado, motivo) => {
			if (conectado) {
				console.log("Pareado.");
				terminar(0);
			} else if (whatsapp?.precisaParear) {
				console.log(!motivo || motivo === MOTIVO_SESSAO_ENCERRADA ? "A sessão guardada foi encerrada no celular. Apague a pasta da sessão e pareie de novo (ver LEIA-ME)." : quedaSemVolta(motivo));
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
async function ensaio(env, fuso = fusoDoProcesso(), pausa = dormir) {
	exigirFuso(fuso);
	const { url, chave } = lerAmbiente(env);
	const trimble = criarTrimble();
	const historicos = /* @__PURE__ */ new Map();
	const janelasPorCelula = {};
	let jaConsultou = false;
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
				if (jaConsultou) await pausa(PAUSA_DA_TRIMBLE_NO_ENSAIO_MS);
				jaConsultou = true;
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
		dormir: () => Promise.resolve(),
		registrar,
		ensaio: true
	});
	registrar("ensaio: nada é enviado nem gravado; os horários abaixo são os de hoje");
	agora = dia + 3e5;
	await servico.volta();
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
			aoMudarConexao: (conectado, motivo) => {
				if (conectado) abriu();
				else if (whatsapp?.precisaParear) falhou(new Error(quedaSemVolta(motivo)));
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
/**
* As bibliotecas escrevem direto no console, sem passar pelo nosso registro. A do protocolo do
* WhatsApp despeja a sessão inteira de uma conversa, com as chaves, a cada "Closing session" — e no
* serviço a saída vai para o journal. Daqui em diante só sai texto: `info`, `warn`, `debug` e `trace`
* ficam mudos (é por eles que as bibliotecas falam); `log` e `error` continuam, mas nunca imprimem
* objeto, e número de telefone sai mascarado.
*/
function calarBibliotecas(alvo = console) {
	const soTexto = (original) => (...partes) => {
		original(semNumeros(partes.map((p) => typeof p === "string" ? p : "[omitido]").join(" ")));
	};
	alvo.log = soTexto(alvo.log.bind(alvo));
	alvo.error = soTexto(alvo.error.bind(alvo));
	const mudo = () => {};
	alvo.info = mudo;
	alvo.warn = mudo;
	alvo.debug = mudo;
	alvo.trace = mudo;
}
/** Este módulo é o arquivo que o `node` foi chamado para rodar? Compara o caminho de verdade: chamado por link simbólico também conta. */
function rodandoComoPrograma(urlDoModulo, chamado) {
	if (!chamado) return false;
	try {
		return urlDoModulo === pathToFileURL(realpathSync(chamado)).href;
	} catch {
		return false;
	}
}
if (rodandoComoPrograma(import.meta.url, process.argv[1])) {
	calarBibliotecas();
	principal(process.argv.slice(2)).then((codigo) => {
		if (codigo !== void 0) process.exit(codigo);
	}).catch((e) => {
		console.error(`Erro: ${mensagemDe(e)}`);
		process.exit(1);
	});
}
//#endregion
export { calarBibliotecas, desenhadorDeQr, ensaio, fusoCerto, horariosDoEnsaio, lerAmbiente, lerArgumentos, ligarServico, limparPareamentoIncompleto, linhaDeRegistro, pastaDaSessao, principal, rodandoComoPrograma, sessaoPareada };
