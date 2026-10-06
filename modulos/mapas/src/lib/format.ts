/** Formatação de números e datas no padrão dos mapas do COA. */

/** Uma casa decimal, ponto como separador, sem ".0" (igual aos rótulos atuais do QGIS). */
export function fmtChuva(v: number): string {
  const r = Math.round(v * 10) / 10;
  const s = r.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export function fmtMilhar(v: number): string {
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const dois = (n: number) => String(n).padStart(2, '0');

export function fmtData(d: Date): string {
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "20/08/2025 00:00" ou "20/08/2025" → Date local; inválido → null */
export function parseDataBr(s: string): Date | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s ?? '');
  if (!m) return null;
  const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, min, seg] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  const d = new Date(ano, mes - 1, dia, h, min, seg);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

/** "01 a 15/02/2025", "01/01 a 15/02/2025", "01/12/2024 a 15/01/2025" ou "15/02/2025" */
export function fmtPeriodo(ini: Date | null, fim: Date | null): string {
  if (!ini && !fim) return '';
  if (!ini || !fim) return fmtData((ini ?? fim) as Date);
  const mesmoAno = ini.getFullYear() === fim.getFullYear();
  const mesmoMes = mesmoAno && ini.getMonth() === fim.getMonth();
  if (mesmoMes && ini.getDate() === fim.getDate()) return fmtData(fim);
  if (mesmoMes) return `${dois(ini.getDate())} a ${fmtData(fim)}`;
  if (mesmoAno) return `${dois(ini.getDate())}/${dois(ini.getMonth() + 1)} a ${fmtData(fim)}`;
  return `${fmtData(ini)} a ${fmtData(fim)}`;
}

/** "05/10/2026 06:00 a 06/10/2026 07:00"; no mesmo dia, "05/10/2026 06:00 a 18:30" (período com hora da integração) */
export function fmtPeriodoHora(ini: Date | null, fim: Date | null): string {
  if (!ini || !fim) return fmtPeriodo(ini, fim);
  const hora = (d: Date) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  const mesmoDia = isoData(ini) === isoData(fim);
  return `${fmtData(ini)} ${hora(ini)} a ${mesmoDia ? '' : `${fmtData(fim)} `}${hora(fim)}`;
}

/** Date → "yyyy-mm-dd" (data local) */
export function isoData(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** "yyyy-mm-dd" (ou ISO com hora) → Date local no mesmo dia do calendário, sem deslocamento de fuso. */
export function parseIsoData(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
