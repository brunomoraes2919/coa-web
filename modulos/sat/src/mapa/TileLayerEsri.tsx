/**
 * `<TileLayer>` do react-leaflet que não mostra o carimbo "Map data not yet
 * available" da Esri no zoom máximo.
 *
 * Quando a URL é da imagem de satélite (World_Imagery), liga o ajuste de
 * `maxNativeZoom` pelo centro do mapa — ver zoomNativoEsri.ts. As demais
 * camadas passam direto; o limite fixo delas (Canvas para no 16) vem nas
 * props, como sempre.
 *
 * A camada é recriada quando a URL muda (`key`): o react-leaflet só troca a
 * URL de uma camada existente, e o `maxNativeZoom` ajustado para o satélite
 * ficaria valendo no fundo que entrasse no lugar.
 */
import { useEffect, useRef } from 'react'
import type L from 'leaflet'
import { TileLayer, useMap, type TileLayerProps } from 'react-leaflet'
import { acompanharZoomNativoEsri, servicoComZoomVariavel } from './zoomNativoEsri'

export default function TileLayerEsri(props: TileLayerProps) {
  const mapa = useMap()
  const camada = useRef<L.TileLayer>(null)
  const { url } = props
  const servico = servicoComZoomVariavel(url)

  useEffect(() => {
    if (!servico || !camada.current) return undefined
    return acompanharZoomNativoEsri(mapa, camada.current, servico)
  }, [mapa, servico, url])

  return <TileLayer key={url} ref={camada} {...props} />
}
