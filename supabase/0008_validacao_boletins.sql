-- COA WEB — Validação PIMS: boletins com falha de integração com o SAP e boletins ainda não integrados.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0007 (pode rodar de novo sem estragar nada).
-- Só acrescenta uma coluna em valid_pims; não altera nem apaga nada que já exista. As regras de acesso
-- da tabela (quem tem a categoria e pode ver a unidade) valem para a coluna nova.

begin;

set local lock_timeout = '5s';

-- [{ o (origem: I insumo, P plantio, T tratamento de sementes, C abastecimento, L lubrificação), n (boletim), d (dia),
--    os (ordem de serviço), eq (coordenador), sit ('F' o SAP recusou | 'P' ainda não integrado), em (quando entrou na fila
--    ou foi lançado), t (tentativas), p1/ul (primeira e última tentativa), m [mensagens do SAP], si (1 = sem item),
--    it [{ c (item), nm (nome), q (quantidade), u (unidade), dp (depósito), s (saldo no SAP), ant (já comprometido por
--          boletins anteriores), pr [problemas previstos] }] }]
alter table public.valid_pims add column if not exists boletins jsonb not null default '[]'::jsonb;

commit;
