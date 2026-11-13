#!/usr/bin/env python3
"""
Sincroniza os dados dos restaurantes do diretório pai (DuoList)
para `data/restaurants.js`, permitindo que o jogo funcione de forma
100% estática (GitHub Pages ou arquivo local).

Inclui higienização estilo `no-ai-slop` e extração automática de pratos/destaques
para tornar os cards do jogo mais diretos e apetitosos.
"""
import json
import os
import re
import unicodedata

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)

CATEGORIES_COLORS = {
    'Pizzaria': '#e74c3c',
    'Italiana': '#c0392b',
    'Hamburgueria': '#e67e22',
    'Japonesa': '#9b59b6',
    'Asiática': '#8e44ad',
    'Carnes': '#a0522d',
    'Churrascaria': '#a0522d',
    'Bistrô': '#1abc9c',
    'Variada': '#3498db',
    'Contemporânea': '#2980b9',
    'Brasileira': '#2ecc71',
    'Bar': '#d97706',
    'Gastrobar': '#f39c12',
}

# Padrões gastronômicos para extrair "Destaques do Cardápio" automaticamente das descrições
DISH_KEYWORDS = [
    r"risoto[s]?(?:\s+de\s+[\wÀ-ÿ]+|\s+[\wÀ-ÿ]+)?",
    r"parmegiana(?:\s+de\s+[\wÀ-ÿ]+)?",
    r"pizza[s]?(?:\s+de\s+fermentação\s+natural|\s+napolitana[s]?|\s+artesanais)?",
    r"forno\s+[àa]\s+lenha",
    r"fermentação\s+natural",
    r"hambúrguer(?:es)?\s+artesanais?",
    r"smash\s+burger[s]?",
    r"sashimi[s]?",
    r"nigiri[s]?",
    r"ramen|lámen",
    r"ceviche[s]?",
    r"polvo(?:\s+grelhado|\s+na\s+brasa)?",
    r"arroz\s+de\s+pato",
    r"arroz\s+negro",
    r"arroz\s+caldo[s]?o",
    r"moqueca(?:\s+de\s+[\wÀ-ÿ]+)?",
    r"acarajé",
    r"bobó\s+de\s+camarão",
    r"picanha(?:\s+grelhada|\s+na\s+brasa)?",
    r"ancho|bife\s+ancho|chorizo|prime\s+rib|t-bone|tomahawk|costela",
    r"parrilla",
    r"forno\s+[àa]\s+brasa",
    r"fettuccine|nhoque|gnocchi|lasanha|ravioli|carbonara|focaccia|burrata",
    r"ostras\s+frescas",
    r"frutos\s+do\s+mar",
    r"carta\s+de\s+vinhos",
    r"drinks\s+autorais|coquetéis\s+autorais|coquetelaria",
    r"cervejas\s+artesanais|chope\s+artesanal",
    r"espaço\s+kids",
    r"música\s+ao\s+vivo",
    r"pet\s+friendly",
    r"rodízio",
]


def extract_highlights(description, rw_data=None):
    """Extrai até 4 tags curtas de pratos/diferenciais da descrição ou menu RW."""
    highlights = []
    seen = set()

    if description:
        for pattern in DISH_KEYWORDS:
            for match in re.finditer(pattern, description, flags=re.IGNORECASE):
                term = match.group(0).strip()
                norm = term.lower()
                if norm not in seen and len(term) >= 5:
                    seen.add(norm)
                    highlights.append(term[0].upper() + term[1:])
                if len(highlights) >= 4:
                    break
            if len(highlights) >= 4:
                break

    if rw_data and isinstance(rw_data, dict):
        menu_type = rw_data.get("menu_type") or rw_data.get("category")
        if menu_type and menu_type.lower() not in seen and len(highlights) < 4:
            highlights.append(f"Menu {menu_type}")

    return highlights[:4]


def strip_ai_slop(text):
    """Remove avisos robóticos e clichês de IA das descrições dos restaurantes."""
    if not text:
        return ""
    cleaned = re.sub(
        r"\*?\(?Conteúdo gerado por IA\.?.*?consulte o restaurante\.?\)?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"Card[áa]pio est[áa] sujeito a altera[çc][õo]es,?\s*consulte o restaurante\.?",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"Instagram:\s*@[\w.]+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def clean_brand(name):
    n = re.sub(r"\(.*?\)", "", name)
    n = re.sub(r"-.*", "", n)
    n = unicodedata.normalize("NFKD", n).encode("ASCII", "ignore").decode("utf-8").lower()
    n = re.sub(r"[^\w\s]", "", n)
    return re.sub(r"\s+", " ", n).strip()


def merge_restaurant_week(bh_restaurants, rw_json_path):
    for d in bh_restaurants:
        d["is_duo"] = True
        d["is_restaurant_week"] = False
        d["restaurant_week"] = None

    if not os.path.exists(rw_json_path):
        return bh_restaurants

    with open(rw_json_path, "r", encoding="utf-8") as f:
        rw_list = json.load(f)

    matched_rw_ids = set()

    for rw in rw_list:
        rw_brand = clean_brand(rw["name"])
        rw_neigh = (
            unicodedata.normalize("NFKD", rw.get("neighborhood", ""))
            .encode("ASCII", "ignore")
            .decode("utf-8")
            .lower()
        )

        found = None
        for d in bh_restaurants:
            d_brand = clean_brand(d["name"])
            d_neigh = (
                unicodedata.normalize("NFKD", d.get("neighborhood", ""))
                .encode("ASCII", "ignore")
                .decode("utf-8")
                .lower()
            )

            if rw_brand == d_brand or (
                len(rw_brand) > 4 and (rw_brand in d_brand or d_brand in rw_brand)
            ):
                if d_neigh and rw_neigh and (rw_neigh in d_neigh or d_neigh in rw_neigh):
                    found = d
                    break
                elif not found:
                    found = d

        if found:
            found["is_restaurant_week"] = True
            found["restaurant_week"] = rw
            matched_rw_ids.add(rw.get("rw_id"))

    for rw in rw_list:
        if rw.get("rw_id") not in matched_rw_ids:
            bh_restaurants.append({
                "name": rw["name"],
                "cuisine": rw.get("cuisine", "Variada"),
                "rating": "RW",
                "neighborhood": rw.get("neighborhood", "Belo Horizonte"),
                "city": "belo-horizonte",
                "address": rw.get("address", ""),
                "phone": rw.get("phone", ""),
                "description": f"Participante da {rw.get('event_edition', 'Restaurant Week')}",
                "instagram": "",
                "website": "",
                "url": rw.get(
                    "rw_page_url",
                    f"https://eventos.restaurantweek.com.br/belohorizonte/restaurante/{rw.get('rw_id', '')}",
                ),
                "lat": rw.get("lat"),
                "lon": rw.get("lon"),
                "schedule": {},
                "is_duo": False,
                "is_restaurant_week": True,
                "restaurant_week": rw,
                "google_rating": None,
                "google_reviews_count": None,
                "google_price_level": None,
                "google_maps_url": None,
                "google_editorial_summary": None,
                "google_business_status": None,
            })

    return bh_restaurants


def main():
    bh_path = os.path.join(PARENT_DIR, "restaurantes_bh.json")
    sp_path = os.path.join(PARENT_DIR, "restaurantes_sp.json")
    rw_path = os.path.join(PARENT_DIR, "restaurant_week_bh.json")

    bh_restaurants = []
    if os.path.exists(bh_path):
        with open(bh_path, "r", encoding="utf-8") as f:
            bh_restaurants = json.load(f)
        bh_restaurants = merge_restaurant_week(bh_restaurants, rw_path)

    sp_restaurants = []
    if os.path.exists(sp_path):
        with open(sp_path, "r", encoding="utf-8") as f:
            sp_restaurants = json.load(f)
        for r in sp_restaurants:
            r["is_duo"] = True
            r["is_restaurant_week"] = False
            r["restaurant_week"] = None

    all_raw = bh_restaurants + sp_restaurants
    exported = []

    for idx, r in enumerate(all_raw):
        cuisine = (r.get("cuisine") or "Variada").strip()
        color = "#64748b"
        for cat, col in CATEGORIES_COLORS.items():
            if cat.lower() in cuisine.lower():
                color = col
                break

        city_raw = (r.get("city") or "Belo Horizonte").replace("-", " ").title()
        neighborhood = (r.get("neighborhood") or "Centro").strip()

        slug = ""
        if r.get("url"):
            slug = r["url"].rstrip("/").split("/")[-1]

        cleaned_desc = strip_ai_slop(r.get("description", ""))
        highlights = extract_highlights(cleaned_desc, r.get("restaurant_week"))

        exported.append({
            "id": idx + 1,
            "slug": slug,
            "name": r.get("name", ""),
            "cuisine": cuisine,
            "rating": r.get("rating", "N/A"),
            "neighborhood": neighborhood,
            "city": city_raw,
            "address": r.get("address", ""),
            "phone": r.get("phone", ""),
            "description": cleaned_desc,
            "highlights": highlights,
            "instagram": r.get("instagram", ""),
            "website": r.get("website", ""),
            "url": r.get("url", ""),
            "lat": r.get("lat"),
            "lon": r.get("lon"),
            "color": color,
            "schedule": r.get("schedule") or {},
            "google_rating": r.get("google_rating"),
            "google_reviews_count": r.get("google_reviews_count"),
            "google_price_level": r.get("google_price_level"),
            "google_maps_url": r.get("google_maps_url"),
            "google_editorial_summary": r.get("google_editorial_summary"),
            "is_duo": bool(r.get("is_duo", True)),
            "is_restaurant_week": bool(r.get("is_restaurant_week", False)),
            "restaurant_week": r.get("restaurant_week"),
        })

    out_dir = os.path.join(BASE_DIR, "data")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "restaurants.js")

    with open(out_file, "w", encoding="utf-8") as f:
        f.write("// Arquivo gerado automaticamente por sync_data.py\n")
        f.write("window.GOURMET_RESTAURANTS = ")
        json.dump(exported, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    with_highlights = sum(1 for x in exported if x["highlights"])
    print(f"✓ Exportados {len(exported)} restaurantes ({with_highlights} com tags de pratos extraídas) para {out_file}")


if __name__ == "__main__":
    main()
