import { useEffect, useRef, useState } from 'react';

interface Props {
  variedade: string;
  /** cor gravada */
  cor: string;
  /** chamado uma vez, quando a pessoa confirma uma cor diferente da gravada (em maiúsculas, "#RRGGBB") */
  onTrocar(cor: string): void;
}

/**
 * Seletor da cor de uma variedade. O onChange do React sai a cada movimento do arraste no seletor e só muda a
 * cor na tela; a gravação espera o evento nativo "change", que o navegador manda quando a pessoa confirma.
 */
export default function SeletorCor({ variedade, cor, onTrocar }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [valor, setValor] = useState(cor.toLowerCase());
  useEffect(() => setValor(cor.toLowerCase()), [cor]);
  // a função mais recente, sem religar o evento a cada desenho
  const trocar = useRef(onTrocar);
  trocar.current = onTrocar;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const confirmar = () => {
      if (el.value.toUpperCase() !== cor.toUpperCase()) trocar.current(el.value.toUpperCase());
    };
    el.addEventListener('change', confirmar);
    return () => el.removeEventListener('change', confirmar);
  }, [cor]);
  return <input ref={ref} type="color" value={valor} aria-label={`Cor de ${variedade}`} onChange={(e) => setValor(e.target.value)} />;
}
