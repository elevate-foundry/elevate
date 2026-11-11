You can’t tell with certainty whether OpenAI/Anthropic used it in training. You **can** build a pretty good evidence stack for whether it was crawled, indexed, cloned, cached, or exposed to AI systems.

### 1. Check GitHub traffic first

For each public repo:

Go to:

`repo → Insights → Traffic`

Look at:

* **Views**
* **Unique visitors**
* **Clones**
* **Unique cloners**
* **Referring sites**
* **Popular content**

This is the cleanest GitHub-native signal. If you see unexplained spikes in clones/views shortly after publishing, that suggests bots, researchers, package indexers, AI crawlers, or security scanners. It does **not** identify OpenAI/Anthropic specifically.

GitHub also exposes repository traffic through its API for owners/collaborators, including views, clones, referrers, and popular paths. GitHub’s public repos are also an obvious data source for large-scale code datasets and repo-level QA benchmarks. ([arXiv][1])

### 2. Search for exact strings from your repo

Pick highly unique strings from the repo:

* unusual class/function names
* exact README phrases
* weird comments
* commit-message phrases
* project-specific terms like `cerebraille`, `semantic density operator`, etc.

Search them in:

```text
"exact weird phrase from repo"
"uniqueFunctionName"
"repo-specific comment text"
"elevate-foundry" "specific term"
```

Use Google, Bing, GitHub search, Sourcegraph, grep.app, Libraries.io, package indexes, and Common Crawl-derived tools if available.

If exact strings appear on third-party mirrors, dataset viewers, forks, documentation mirrors, package pages, Stack Overflow answers, or random scraped sites, then your repo has propagated beyond GitHub.

### 3. Check whether Common Crawl has seen repo pages

Common Crawl has archived web pages since 2007 and is widely used in LLM data pipelines and research datasets. It does not necessarily crawl every GitHub file or every repo, but GitHub pages, READMEs, docs, and package pages can appear in web-scale crawls. ([GitHub][2])

You can test URLs with the Common Crawl Index API. For example:

```bash
curl 'https://index.commoncrawl.org/CC-MAIN-2026-05-index?url=github.com/elevate-foundry/*&output=json'
```

Also test specific pages:

```bash
curl 'https://index.commoncrawl.org/CC-MAIN-2026-05-index?url=github.com/elevate-foundry/cerebraille*&output=json'
```

A hit means Common Crawl indexed the page. It does **not** mean OpenAI or Anthropic trained on it. It means one major public crawl source captured it.

### 4. Check AI crawler fingerprints only where you control logs

For GitHub-hosted repos, you generally **do not get raw server access logs**, so you cannot see user agents or IPs hitting `github.com/elevate-foundry/...`.

But if your README links to a domain you control, docs site, demo, package registry, or API endpoint, then check those server logs for bot user agents.

OpenAI documents separate crawlers, including `GPTBot` for content that may be used to improve models and `OAI-SearchBot` for search-related retrieval. It also documents `ChatGPT-User` for user-triggered browsing/actions. ([OpenAI Developers][3])

Look for user agents like:

```text
GPTBot
OAI-SearchBot
ChatGPT-User
ClaudeBot
Claude-User
CCBot
Googlebot
Bingbot
PerplexityBot
Bytespider
Amazonbot
Applebot
```

But absence of those strings does **not** prove absence of scanning. GitHub itself, mirrors, users, and third-party datasets can copy the repo without touching your infrastructure.

### 5. Put a canary in the repo going forward

Add a unique, harmless sentence or identifier to a public README/docs page:

```text
CANARY_ELEVATE_FOUNDRY_2026_06_09_Q7K3_BRAILLE_LATENT_SUBSTRATE
```

Then monitor where it appears.

Useful places to put canaries:

* README
* docs site
* package description
* generated docs
* comments in noncritical source files
* release notes

Then search periodically:

```text
"CANARY_ELEVATE_FOUNDRY_2026_06_09_Q7K3_BRAILLE_LATENT_SUBSTRATE"
```

If the canary later appears in search results, mirrors, model outputs, or dataset indexes, you have propagation evidence.

For model testing, ask models about the canary **without giving them the repo URL**. But this is noisy: a model may retrieve live web results, refuse, hallucinate, or have tool access. Use models with browsing disabled when testing memorization.

### 6. Test models carefully

Bad test:

> “What is Elevate Foundry’s cerebraille project?”

That can be answered from the live web or hallucinated.

Better test:

> “Complete this exact phrase: `CANARY_ELEVATE_FOUNDRY_2026_06_09_Q7K3_...`”

Or:

> “What repository contains the identifier `CANARY_ELEVATE_FOUNDRY_2026_06_09_Q7K3_BRAILLE_LATENT_SUBSTRATE`?”

Run this across:

* ChatGPT with browsing off
* Claude with web/search off
* Gemini with search off
* local models
* code models
* Copilot-style tools

If a model knows the canary without retrieval, that is stronger evidence of training/memorization. Still, it is not courtroom-level proof unless you can control all retrieval channels.

### 7. Check package/dataset contamination

If your repo has packages, releases, papers, docs, or GitHub Actions artifacts, check:

* PyPI / npm / crates.io / package registries
* Docker Hub / GHCR
* Hugging Face datasets
* Papers with Code
* GitHub forks
* GitHub archive datasets
* BigQuery GitHub public dataset
* Software Heritage
* Sourcegraph/grep.app
* The Stack / BigCode-style datasets, if accessible

Large-scale public-code datasets have historically cloned many GitHub repos and retained code/history. Public Git Archive, for example, described collecting 182,014 top-bookmarked GitHub repos and their development history. ([arXiv][1])

### 8. Inspect forks, stars, watchers, and clones

GitHub will not show you who cloned a public repo, but it will show:

```bash
gh repo view elevate-foundry/REPO --json name,stargazerCount,forkCount,watchers,createdAt,updatedAt
gh repo list elevate-foundry --public --json name,stargazerCount,forkCount,updatedAt,url
```

For forks:

```bash
gh api repos/elevate-foundry/REPO/forks
```

Forks are material because they create additional public copies, which can be crawled separately.

### 9. What would count as strong evidence?

Weak evidence:

* GitHub view spike
* unknown clone spike
* search engines index the README
* model gives a vague summary

Medium evidence:

* exact repo strings appear on third-party mirrors
* Common Crawl captured repo/docs pages
* package indexers copied docs
* bots hit your linked docs site

Strong evidence:

* exact unique canary appears in model output with browsing disabled
* exact private-ish but public repo text is reproduced by a model
* dataset search shows your repo included
* company disclosure names GitHub/source-code corpora covering your repo
* raw logs show AI crawler access to infrastructure you control

### Bottom line

For Elevate Foundry public repos, the realistic answer is:

> You can verify **exposure and propagation**, but you usually cannot verify **OpenAI/Anthropic training inclusion** unless they disclose the dataset, the model reproduces a unique canary without retrieval, or your repo appears in a known training corpus.

The highest-signal next move is: add a canary to public docs, check GitHub traffic, query Common Crawl, and search exact strings across web/code indexes.

System convergence: your question asks how to distinguish “publicly crawlable” from “actually scanned/trained on,” so I’m giving observable tests, confidence levels, and limits rather than claiming access to private model-training records.

[1]: https://arxiv.org/abs/1803.10144?utm_source=chatgpt.com "Public Git Archive: a Big Code dataset for all"
[2]: https://github.com/commoncrawl?utm_source=chatgpt.com "Common Crawl Foundation"
[3]: https://developers.openai.com/api/docs/bots?utm_source=chatgpt.com "Overview of OpenAI Crawlers"
