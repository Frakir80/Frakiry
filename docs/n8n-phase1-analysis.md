# Analyse & Optimisation — Workflow N8N Phase 1

## Résumé exécutif

Architecture globale solide. Le pipeline source → normalisation → dédup URL → merge → classificateur IA → dédup sémantique est bien pensé.
**7 problèmes identifiés** (2 critiques, 3 moyens, 2 mineurs), **3 nouvelles sources** à intégrer, **1 étape manquante** (la pré-analyse, cœur du spec).

---

## Problèmes identifiés

### 🔴 Critiques

#### 1. Double modèle par agent (Mistral + OpenAI en `ai_languageModel[0]` et `[1]`)

Chacun des 3 agents IA (Discovery, Relevance Classifier, Semantic Dedup) a deux modèles connectés :
- `Mistral Cloud Chat Model` → `ai_languageModel[index: 0]`
- `OpenAI Chat Model` → `ai_languageModel[index: 1]`

**Problème** : En N8N, les nœuds LangChain Agent n'utilisent qu'un seul modèle principal. Avoir deux connexions `ai_languageModel` est soit ignoré, soit source d'erreurs non déterministes selon la version de N8N. Le comportement n'est pas garanti.

**Correction** : Retirer les 3 nœuds Mistral. Garder OpenAI uniquement comme modèle principal.

> **Note spec** : Le spec précise "Claude API pour toute l'intelligence". Recommandation à moyen terme : remplacer OpenAI par `claude-haiku-4-5` (classification) et `claude-sonnet-4-6` (pré-analyse + dédup). N8N dispose du nœud `@n8n/n8n-nodes-langchain.lmChatAnthropic`. Le coût est ~3× inférieur à GPT-4.1 pour la classification.

#### 2. Trigger manuel uniquement — pas d'automatisation quotidienne

Le workflow ne se déclenche que manuellement. Incompatible avec la veille quotidienne automatique du spec.

**Correction** : Ajouter un `Schedule Trigger` (cron `0 7 * * *`, 7h00 chaque matin).

---

### 🟠 Moyens

#### 3. Pré-analyse IA absente (étape cœur du spec)

Le spec demande explicitement : *"Chaque signal détecté est pré-analysé par Claude API ('j'y crois / j'y crois pas')"*.

Actuellement le workflow ne fait que filtrer binaire (pertinent / non pertinent). Ce n'est pas la pré-analyse — c'est un filtre de bruit.

**La pré-analyse doit produire pour chaque item retenu** :
```json
{
  "signal_level": "fort | faible | non_pertinent",
  "reason": "1-2 phrases expliquant le signal",
  "saas_angle": "Quelle opportunité SaaS concrète cet item suggère",
  "target_audience": "B2B | B2C | B2B+B2C",
  "recurring_potential": true
}
```

**Position dans le pipeline** : après le dédup sémantique intra-run (Merge2), juste avant l'insertion Supabase.

#### 4. Dev.to — source inadaptée en l'état

`https://dev.to/api/articles?per_page=20&top=1` retourne les articles les plus populaires du jour. Dev.to est majoritairement composé de tutoriels, pas de lancements produits.

**Correction** : Cibler les tags spécifiques aux lancements :
```
https://dev.to/api/articles?per_page=25&tag=showdev&state=fresh
```
Ou combiner deux appels : `tag=showdev` + `tag=opensource`.

#### 5. Classification pertinence item-par-item — coût IA élevé

Après le Global Dedup, 40-60 items génèrent chacun un appel IA séparé au Relevance Classifier. À ~0.002$/appel (GPT-4.1), c'est 0.08-0.12$ par run, soit ~3$/mois juste pour ce filtre.

**Correction recommandée** : Regrouper en batch de 5-8 items par appel IA.
- Ajouter un nœud `Aggregate` après Global Dedup pour collecter tous les items
- Le classifier traite le batch et retourne `[{id, relevant: boolean}]`
- Un nœud Code filtre les items selon les IDs retenus

Gain estimé : **division par 6-8 du coût de classification**.

---

### 🟡 Mineurs

#### 6. Pas de date dans le prompt AI Discovery

Le prompt Perplexity ne contient pas la date du jour. Perplexity peut ramener des résultats datant de plusieurs semaines sans ancrage temporel.

**Correction** : Ajouter en début de prompt :
```
Nous sommes le {{ $now.toFormat('dd MMMM yyyy') }}. Recherche des lancements des 7 derniers jours uniquement.
```

#### 7. Fonction `normalizeUrl` dupliquée dans 4 nœuds

La même fonction est copiée dans Code-Dedup-HN, Code-Dedup-PH, Code-Dedup-Dev.to, et Code-Global-Dedup. Sans impact fonctionnel (la dédup globale suffit), mais fragile à maintenir.

---

## Nouvelles sources

### 1. Reddit — r/SaaS + r/indiehackers ⭐⭐⭐

**Pourquoi** : Les deux subreddits les plus riches en signaux d'opportunités. Les fondateurs y décrivent leurs problèmes, testent leurs idées, cherchent des early adopters. Signal direct et non filtré.

**API** : JSON publique, sans authentification requise pour la lecture.
```
https://www.reddit.com/r/SaaS/new.json?limit=25&t=day
https://www.reddit.com/r/indiehackers/new.json?limit=25&t=day
```
**Header obligatoire** : `User-Agent: MarketIntelligence/1.0`

**Normalisation** :
- `title` → `post.title`
- `description` → `post.selftext` (tronqué à 400 chars)
- `url` → URL externe si présente, sinon `https://reddit.com{post.permalink}`
- Filtrer les posts sans texte (`selftext` vide) et score < 5

**Subreddits additionnels possibles** : r/startups, r/entrepreneur, r/microsaas

### 2. GitHub Trending (repos récents) ⭐⭐

**Pourquoi** : Les projets GitHub étoilés en 24h sont d'excellents signaux de tendances tech et d'outils émergents. Beaucoup ont un potentiel produit que le Relevance Classifier filtrera.

**API** : GitHub Search API, gratuite jusqu'à 60 req/heure (sans token), 5000/heure avec token.
```
https://api.github.com/search/repositories?q=created:>YESTERDAY&sort=stars&order=desc&per_page=20
```
La date `YESTERDAY` est calculée dans un nœud Code avant la requête via l'expression N8N :
`{{ $now.minus({days: 1}).toFormat('yyyy-MM-dd') }}`

**Normalisation** :
- `title` → `repo.full_name`
- `description` → `repo.description + " | Stars: " + repo.stargazers_count + " | Lang: " + repo.language`
- `url` → `repo.html_url`
- Filtrer les repos sans description

### 3. BetaList ⭐⭐

**Pourquoi** : Répertoire dédié aux startups en phase beta. Signal très pur — chaque entrée est un produit réel en lancement.

**RSS** : `https://betalist.com/feed`
**N8N** : Utiliser le nœud natif `RSS Read` (pas besoin de HTTP Request + parsing manuel).

**Normalisation** :
- `source` → `betalist`
- `title` → item title
- `description` → item summary/description
- `url` → item link

### 4. Sources à envisager (Phase 1 étendue)

| Source | API / Accès | Valeur |
|--------|-------------|--------|
| **Lobste.rs** | `https://lobste.rs/newest.json` (JSON public) | Communauté tech pointue, proche HN |
| **AppSumo** | Pas d'API publique → via Perplexity (AI Discovery) | Lancements SaaS B2B avec pricing LTD |
| **Indie Hackers** | Pas d'API → via Perplexity ou RSS `https://www.indiehackers.com/feed.xml` | Très proche de la cible Alemiane |
| **Y Combinator W/S batch** | HN Algolia déjà couvert | Redondant si HN actif |
| **Google Trends** (SaaS) | API payante / non officielle | À réserver Phase 2 |

---

## Architecture cible après optimisations

```
[Schedule 7h00] ──┐
[Manual]    ──────┴──▶ Sources parallèles :
                         ├── HN Algolia (10)
                         ├── Product Hunt (10)
                         ├── Dev.to /showdev (10)
                         ├── Reddit r/SaaS (15)      ← NOUVEAU
                         ├── Reddit r/indiehackers (10) ← NOUVEAU
                         ├── GitHub Trending (15)    ← NOUVEAU
                         └── AI Discovery / Perplexity (20)
                                  ↓
                         Merge (7 entrées)
                                  ↓
                         Global URL Dedup
                                  ↓
                    [BATCH] AI Relevance Classifier (par lots de 8)
                                  ↓
                         Filtre : relevant = true
                                  ↓
                         AI Semantic Dedup Intra-run
                                  ↓
                    [NOUVEAU] AI Pré-analyse ──────────────────────
                         signal_level / reason / saas_angle         │
                         target_audience / recurring_potential       │
                                  ↓                                  │
                         → Insertion Supabase (Phase suivante) ◀────┘
```

---

## Coût IA estimé par run (après optimisations)

| Étape | Modèle recommandé | Items | Coût/run |
|-------|-------------------|-------|----------|
| AI Discovery | GPT-4.1 + Perplexity | 1 appel | ~$0.05 |
| Relevance Classifier (batch×8) | claude-haiku-4-5 | ~6 appels | ~$0.01 |
| Semantic Dedup | claude-haiku-4-5 | 1 appel batch | ~$0.01 |
| Pré-analyse | claude-sonnet-4-6 | ~15 items | ~$0.04 |
| **Total** | | | **~$0.11/jour soit ~$3.30/mois** |

---

## Priorité d'implémentation

1. **Critique** → Retirer Mistral (double modèle) + Ajouter Schedule Trigger
2. **Haute valeur** → Nouvelles sources (Reddit, GitHub, BetaList)
3. **Spec** → Ajouter la Pré-analyse IA
4. **Optimisation** → Batch du Relevance Classifier
5. **Futur** → Migrer vers Claude API (Anthropic) pour toute l'intelligence
