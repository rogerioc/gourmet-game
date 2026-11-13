# 🎲 Gourmet Game BH — Qual o Seu Restaurante de Hoje?

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Aplicação web interativa (100% estática, pronta para GitHub Pages) para decidir de forma divertida onde comer usando a base unificada do **Duo Gourmet** e **Restaurant Week** do [Gourmet Map BH](https://rogerioc.github.io/gourmet-map/).

## 🎮 Modos de Jogo

1. **🏆 Copa do Jantar (Batalha de Restaurantes)**
   - Sorteia **4 (Express)**, **8 (Copa Clássica)** ou **16 (Super Copa)** restaurantes de marcas distintas dentro do filtro escolhido.
   - Apresenta duelos 1 contra 1 lado a lado (com culinária, bairro, avaliação Duo/Google, tags de pratos em destaque e horário do dia).
   - Inclui árvore visual do chaveamento em **SVG (`SVG.js`)**, atalhos de teclado (`1`/`⬅️` e `2`/`➡️`) e botão para trocar uma dupla na 1ª fase.

2. **🎰 Roleta Gourmet com Trava 🔒 (Slot Machine)**
   - **3 Rolos sincronizados**: `1. Culinária` • `2. Bairro` • `3. Restaurante`.
   - Permite **travar 🔒** a culinária ou o bairro sorteado (ou escolher manualmente na lista) e girar apenas os demais rolos garantindo apenas combinações válidas.

3. **👑 Tela do Campeão de Hoje + Plano B Inteligente**
   - Mini-mapa interativo **Leaflet**, tabela completa de horários da semana (destacando o dia atual), link direto para o **Gourmet Map BH** (`?r=slug`), rota no Google Maps, botão de **Convite para WhatsApp** e **3 recomendações de Plano B por afinidade + distância**.

## 🔄 Atualizando os Dados

Para ressincronizar com os JSONs mais recentes da pasta principal (`../restaurantes_bh.json`, `../restaurant_week_bh.json` e `../restaurantes_sp.json`):

```bash
python3 sync_data.py
```

## 📄 Licença & Créditos

Distribuído sob a [Licença MIT](LICENSE).  
Criado por **[Rogerio C.S](https://rogerioc.github.io/about/)**. Ao reutilizar, adaptar ou redistribuir este código, mantenha os créditos ao autor original.
