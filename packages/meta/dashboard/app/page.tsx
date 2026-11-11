import snapshot from "../data/snapshot.json";

type Repo = {
  name: string;
  url?: string;
  stars?: number | null;
  forksNum: number;
  commits?: number | null;
  isFork?: boolean | null;
  language?: string | null;
  createdAt?: string | null;
  pushedAt?: string | null;
  views?: string;
  clones?: string;
  crawl?: string;
  crawlNum?: number | null;
  crawlError?: boolean;
  bifm?: { kappa: number; sigma: number; delta: number; byte: number; cell: string; words: string };
};

type ForkGroup = {
  repo: string;
  forks: { full_name: string; html_url: string; created_at: string; owner?: string }[];
};

type AuditEvent = {
  ts: string;
  seq: number;
  event: string;
  target: string;
  outcome: string;
  hash?: string;
  verified: boolean;
};

type Snapshot = {
  generatedAt: string;
  owner: string;
  sweepDir: string | null;
  totals: {
    publicRepos: number;
    reposWithForks: number;
    totalForks: number;
    crawlCaptures: number;
    crawlErrors: number;
    totalStars: number;
    totalCommits: number;
    nativeCommits: number;
    lastActivity: string | null;
  };
  repos: Repo[];
  forkDetails: ForkGroup[];
  audit: {
    present: boolean;
    integrityOk: boolean | null;
    recordCount: number;
    badCount?: number;
    events: AuditEvent[];
  };
};

const data = snapshot as unknown as Snapshot;

function crawlBadge(r: Repo) {
  if (r.crawlError) return <span className="badge err">error</span>;
  if (r.crawlNum && r.crawlNum > 0)
    return <span className="badge hit">{r.crawlNum} capture{r.crawlNum > 1 ? "s" : ""}</span>;
  if (r.crawl === "0") return <span className="badge zero">0</span>;
  return <span className="badge na">n/a</span>;
}

export default function Page() {
  const t = data.totals;
  const audit = data.audit;

  return (
    <main className="wrap">
      <header className="header">
        <h1>Exposure Dashboard</h1>
        <div className="sub">
          AI crawl / training exposure for public repos under{" "}
          <a href={`https://github.com/${data.owner}`}>github.com/{data.owner}</a>
        </div>
        <div className="meta">
          generated {new Date(data.generatedAt).toLocaleString()} · source: {data.sweepDir ?? "n/a"}
          {t.lastActivity ? ` · last push ${t.lastActivity}` : ""}
        </div>
      </header>

      {/* ---- summary cards ---- */}
      <div className="grid">
        <Stat label="Public repos" value={t.publicRepos} />
        <Stat label="Repos with forks" value={t.reposWithForks} cls="accent" />
        <Stat label="Total fork copies" value={t.totalForks} cls="accent" hint="extra public copies" />
        <Stat
          label="Common Crawl"
          value={t.crawlErrors > 0 && t.crawlCaptures === 0 ? "—" : t.crawlCaptures}
          cls={t.crawlCaptures > 0 ? "amber" : undefined}
          hint={t.crawlErrors > 0 ? `${t.crawlErrors} inconclusive` : "captures"}
        />
        <Stat label="Total stars" value={t.totalStars} />
        <Stat
          label="Commits"
          value={t.totalCommits.toLocaleString()}
          hint={`${t.nativeCommits.toLocaleString()} native (non-fork)`}
        />
      </div>

      {/* ---- audit trail status ---- */}
      <section className="section">
        <h2>
          SOC 2 Audit Trail <span className="count">{audit.recordCount} records</span>
        </h2>
        <div className="panel" style={{ padding: 18 }}>
          <div style={{ marginBottom: audit.events.length ? 16 : 0 }}>
            {!audit.present ? (
              <span className="audit-status absent">
                <span className="dot" /> No audit log found — run a sweep to generate one
              </span>
            ) : audit.integrityOk ? (
              <span className="audit-status ok">
                <span className="dot" /> Hash chain verified · {audit.recordCount} records · no tampering detected
              </span>
            ) : (
              <span className="audit-status bad">
                <span className="dot" /> INTEGRITY FAILURE · {audit.badCount} record(s) failed verification
              </span>
            )}
          </div>
          {audit.events.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
              {audit.events.slice(-12).reverse().map((e) => (
                <div className="event" key={e.seq}>
                  <span className="ts">{(e.ts || "").replace("T", " ").replace("Z", "")}</span>
                  <span className="ev">{e.event}</span>
                  <span className="tg">{e.target}</span>
                  <span className="hash">{e.verified ? "✓" : "✗"} {e.hash}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- repos table ---- */}
      <section className="section">
        <h2>
          Repositories <span className="count">{data.repos.length}</span>
        </h2>
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Repository</th>
                <th>Commits</th>
                <th>Stars</th>
                <th>Forks</th>
                <th>Last push</th>
                <th>Created</th>
                <th>BIFM-256</th>
                <th>Views (14d)</th>
                <th>Clones (14d)</th>
                <th>Common Crawl</th>
              </tr>
            </thead>
            <tbody>
              {data.repos.map((r) => (
                <tr key={r.name}>
                  <td>
                    <a className="repo-link" href={r.url}>
                      {r.name}
                    </a>
                    {r.isFork ? <span className="badge na" style={{ marginLeft: 8 }}>fork</span> : null}
                  </td>
                  <td className="num">{r.commits != null ? r.commits.toLocaleString() : "—"}</td>
                  <td className="num">{r.stars ?? "—"}</td>
                  <td className="num">
                    {r.forksNum > 0 ? (
                      <span className="badge warn">{r.forksNum}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td className="num muted">{r.pushedAt ?? "—"}</td>
                  <td className="num muted">{r.createdAt ?? "—"}</td>
                  <td>
                    {r.bifm ? (
                      <span className="bifm" title={`byte ${r.bifm.byte} · ${r.bifm.words}`}>
                        <span className="bifm-cell">{r.bifm.cell}</span>
                        <span className="muted">κ{r.bifm.kappa} σ{r.bifm.sigma} δ{r.bifm.delta}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num muted">{r.views && r.views !== "-" ? r.views : "—"}</td>
                  <td className="num muted">{r.clones && r.clones !== "-" ? r.clones : "—"}</td>
                  <td>{crawlBadge(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- fork details ---- */}
      {data.forkDetails.length > 0 && (
        <section className="section">
          <h2>
            Fork Copies <span className="count">extra public copies that can be crawled separately</span>
          </h2>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Source repo</th>
                  <th>Fork</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.forkDetails.flatMap((g) =>
                  g.forks.map((fk) => (
                    <tr key={fk.full_name}>
                      <td className="muted">{g.repo}</td>
                      <td>
                        <a href={fk.html_url}>{fk.full_name}</a>
                      </td>
                      <td className="num muted">{fk.created_at}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="footer">
        This dashboard verifies <strong>exposure and propagation</strong> (forks, web-crawl captures,
        GitHub traffic), not training inclusion. The audit trail is an append-only, hash-chained
        (sha256) log mapped to SOC 2 CC6/CC7 — any edit, deletion, or reordering breaks the chain and
        is flagged above. Data is a static snapshot produced by the exposure-toolkit; re-run{" "}
        <code>npm run ingest</code> to refresh.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  cls,
  hint,
}: {
  label: string;
  value: number | string;
  cls?: string;
  hint?: string;
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`value ${cls ?? ""}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
