# Formalizing the Biometric/Behavioral Fusion Engine: A Noise-Resilient, Zero-Cookie Identity Protocol

## Abstract

Modern identity architectures are undergoing a paradigm shift away from local persistent cookies, tracking tokens, and static hardware registers due to systemic tracking vulnerabilities and privacy regulations [1]. The Biometric/Behavioral Identity (BBID) framework represents a zero-cookie, zero-local-storage paradigm that synthesizes a user's physical and behavioral interaction with a device into a cryptographically stable, highly unique identity token [3]. This document presents a formalized specification of the Biometric/Behavioral Fusion Engine, which implements a noise-resilient identity protocol using signed random projection locality-sensitive hashing, fuzzy commitment schemes, and edge-derived deterministic user-specific projection.

---

## 1. Feature Vector Space Formulation

### 1.1 Composite Feature Vector Definition

To move beyond the limitations of naive hashing pipelines—which suffer from extreme avalanche effects and lack tolerance for human or environmental fluctuations [2]—the system implements a formalized Biometric/Behavioral Fusion Engine. This engine models the user's complete device state and real-time behavioral dynamics as a high-dimensional composite feature vector:

$$
\mathbf{X} = \begin{bmatrix} \mathbf{H} \\ \mathbf{B} \end{bmatrix} \in \mathbb{R}^D
$$

where the total dimensionality $D = d_H + d_B$ is the direct sum of a deterministic hardware subspace $\mathbf{H} \in \mathbb{R}^{d_H}$ and a stochastic behavioral subspace $\mathbf{B} \in \mathbb{R}^{d_B}$ [6].

```
                Composite Feature Vector X ∈ ℝ^D
  ┌───────────────────────────────────────────────┐
  │ Deterministic Subspace H                      │ ──> Categorical metrics mapped to
  │ (Canvas, WebGL, CPU, Geometry, PUF, PPA)      │     discrete integer coordinates 
  ├───────────────────────────────────────────────┤
  │ Stochastic Subspace B                         │ ──> Continuous biometrics subject to
  │ (Keystroke dynamics, Mouse, Scroll, Touch)    │     environmental noise ε 
  └───────────────────────────────────────────────┘
```

### 1.2 Deterministic Hardware Subspace

The deterministic hardware subspace $\mathbf{H}$ establishes a baseline by aggregating categorical, physical device parameters [3]. These metrics include:

- Canvas rendering outputs
- WebGL constants
- CPU core configurations
- Screen geometry

To bolster security, this subspace is extended with silicon-level hardware biometrics:

- **Physical Unclonable Function (PUF)**: Challenge-response pairs measuring unique microscopic manufacturing variations
- **Physical AI (PPA)**: Silicon finger-channel matrices measuring crystal oscillator drift and cache timing latency curves [3]

These deterministic coordinates are treated as discrete categorical coordinates and mapped directly to integer spaces to ensure consistency across separate evaluation intervals [3].

### 1.3 Stochastic Behavioral Subspace

Conversely, the stochastic behavioral subspace $\mathbf{B}$ captures continuous, dynamic human-interaction signals [7]. These signals include:

- Mean keystroke flight time
- Mouse acceleration variance
- Scroll velocity entropy
- Math calculation latency
- Touch-gesture trajectory dynamics

Because these behavioral features are subjected to persistent human, physical, and cognitive variations, any two observations $\mathbf{X}_i$ and $\mathbf{X}_j$ gathered from the same user across different sessions satisfy the relationship:

$$
\mathbf{X}_i = \mathbf{X}_j + \boldsymbol{\epsilon}, \quad \boldsymbol{\epsilon} \sim \mathcal{N}(\mathbf{0}, \boldsymbol{\Sigma})
$$

where $\boldsymbol{\epsilon}$ represents a multivariate Gaussian measurement noise vector governed by a covariance matrix $\boldsymbol{\Sigma}$ [7].

### 1.4 Privacy Considerations

Storing or transmitting raw biometric templates $\mathbf{X}$ presents severe privacy risks, as compromised databases allow adversaries to mount template-reconstruction attacks and reverse-engineer the user's physical attributes [7]. Consequently, the BBID pipeline must pass these vectors through a non-invertible, cancelable transformation, ensuring that the original feature space cannot be reverse-engineered even if compromised templates are exposed [13].

### 1.5 Hardware Trust Model and Deployment Context

#### 1.5.1 Browser Fingerprinting Volatility

On the open web, browser-derived categorical metrics for $\mathbf{H}$ are subject to significant volatility. Canvas rendering outputs shift across browser versions, GPU driver updates alter WebGL constants, and OS patches modify reported screen geometry. These metrics are not cryptographically stable anchors; they are high-variance observations subject to their own noise process:

$$
\mathbf{H}_i = \mathbf{H}_j + \boldsymbol{\epsilon}_H, \quad \boldsymbol{\epsilon}_H \sim \mathcal{N}(\mathbf{0}, \boldsymbol{\Sigma}_H)
$$

where $\boldsymbol{\Sigma}_H$ captures browser-update-induced variance, driver-version drift, and rendering-engine non-determinism.

#### 1.5.2 Deployment Tier Classification

The trust placed in $\mathbf{H}$ is a function of deployment context:

| Deployment Tier | $\mathbf{H}$ Trust Level | $\boldsymbol{\Sigma}_H$ Magnitude | Recommended Usage |
|-----------------|--------------------------|-----------------------------------|-------------------|
| Open Web (Browser) | Low | High ($\|\boldsymbol{\Sigma}_H\| \gg 0$) | Coarse filtering only; primary identity signal from $\mathbf{B}$ |
| Native Enterprise App | Medium | Moderate | Hardware binding with TPM-backed attestation |
| Hardware-Bound (PUF/PPA) | High | Low ($\|\boldsymbol{\Sigma}_H\| \approx 0$) | Cryptographic anchor; silicon-level identity root |

#### 1.5.3 Recommendation

For open-web deployments, $\mathbf{H}$ is treated as a semi-deterministic coarse filter rather than a cryptographic anchor. The primary identity signal derives from the behavioral subspace $\mathbf{B}$, with $\mathbf{H}$ serving only to prune the search space during authentication. Full cryptographic binding to $\mathbf{H}$ is reserved for native enterprise applications where hardware-backed PUF or PPA attestation is guaranteed.

---

## 2. The Analog-to-Digital Bridge: Random Projection LSH

### 2.1 Signed Random Projection LSH

To convert the noisy continuous vector $\mathbf{B}$ into a stable identity token without relying on persistent local storage or cookies, the Biometric/Behavioral Fusion Engine passes the behavioral subspace through a Signed Random Projection (SRP) Locality-Sensitive Hashing (LSH) filter, commonly referred to as SimHash [5].

While standard cryptographic hash functions (such as SHA-256) are designed to maximize the avalanche effect—where a single-bit change in the input yields a completely uncorrelated output—LSH functions are mathematically formulated to maximize hashing collisions for similar inputs [16].

### 2.2 Hyperplane Generation

The protocol defines a set of $k$ random hyperplanes:

$$
\mathcal{R} = \{\mathbf{r}_1, \mathbf{r}_2, \ldots, \mathbf{r}_k\}, \quad \mathbf{r}_i \sim \mathcal{N}(\mathbf{0}, \mathbf{I}_{d_B})
$$

where each hyperplane $\mathbf{r}_i$ is drawn from a standard normal distribution $\mathcal{N}(\mathbf{0}, \mathbf{I}_{d_B})$ [16].

### 2.3 Projection Function

The projection function $h_{\text{SRP}}: \mathbb{R}^{d_B} \rightarrow \{0, 1\}^k$ generates a $k$-bit binary string where the $i$-th bit is defined as:

$$
w_i = \mathbb{I}[\mathbf{r}_i \cdot \mathbf{B} \geq 0] = 
\begin{cases} 
1 & \text{if } \mathbf{r}_i \cdot \mathbf{B} \geq 0 \\
0 & \text{if } \mathbf{r}_i \cdot \mathbf{B} < 0 
\end{cases}
$$

### 2.4 Locality-Preserving Properties

This signed projection acts as an analog-to-digital bridge, mapping the high-dimensional continuous biometric space directly to the discrete Hamming space $\{0, 1\}^k$ while preserving the cosine similarity between separate sessions [20]. The probability that any given bit matches between two separate visits $\mathbf{B}_i$ and $\mathbf{B}_j$ is directly proportional to the angular similarity of the user's underlying hardware and behavioral profile [20]:

$$
P[w_i(\mathbf{B}_i) = w_i(\mathbf{B}_j)] = 1 - \frac{\theta_{ij}}{\pi}
$$

Where the angular distance is defined as:

$$
\theta_{ij} = \arccos\left(\frac{\mathbf{B}_i \cdot \mathbf{B}_j}{\|\mathbf{B}_i\| \|\mathbf{B}_j\|}\right)
$$

This locality-preserving property ensures that small variations in typing speed, mouse acceleration, or processing latency result in a highly bounded Hamming distance between the resulting bit-strings $\mathbf{w}_i$ and $\mathbf{w}_j$ [6].

### 2.5 Comparative Analysis of Transformation Methods

While alternative dimension-reduction and hashing techniques exist, random projection is preferred for its balanced trade-off between computational efficiency, distance preservation, and template security [13]. The table below contrasts random projection with other common indexing and transformation methods in biometric template protection.

| Indexing/Transformation Methodology | Distance Metric Preserved | Security Classification | Computational Complexity | Vulnerability to Compromise |
|-------------------------------------|---------------------------|-------------------------|--------------------------|------------------------------|
| Random Projection (SRP-LSH) [16] | Cosine Similarity [20] | Cancelable / Non-Invertible [13] | $\mathcal{O}(kd)$ [25] | Low (Underdetermined System) [26] |
| Lean Walsh Transform [25] | $\ell_2$ Norm (Bounded) [25] | Cancelable / Non-Invertible [25] | $\mathcal{O}(d \log d)$ [25] | Low (With Random Sign Diagonal) [25] |
| Data-Aware Transformation (PCA) [28] | Maximized Variance [28] | Invertible without Keys [26] | $\mathcal{O}(d^3)$ [29] | High (Exposes Data Distribution) [28] |
| Bio-Hashing (Orthogonal) [20] | Euclidean Distance [26] | Key-Dependent [21] | $\mathcal{O}(kd)$ [26] | High (Fully Invertible if Key Stolen) [21] |

### 2.6 Entropy Regularization via Feature Decorrelation

#### 2.6.1 The Correlation Problem

Behavioral features in $\mathbf{B}$ exhibit significant cross-correlation. Typing speed correlates with mouse velocity, scroll entropy correlates with interaction cadence, and keystroke variance correlates with overall motor precision. These correlations reduce the effective min-entropy of the resulting bitstring $\mathbf{w}$, as correlated features contribute redundant rather than independent bits.

Let $\mathbf{C}_B = \text{diag}(\boldsymbol{\Sigma}_B)^{-1/2} \boldsymbol{\Sigma}_B \text{diag}(\boldsymbol{\Sigma}_B)^{-1/2}$ be the behavioral correlation matrix. The effective dimensionality of $\mathbf{B}$ is bounded by the rank of $\mathbf{C}_B$, which for highly correlated features satisfies $\rank(\mathbf{C}_B) \ll d_B$.

#### 2.6.2 Decorrelation Transform

Before the SRP-LSH step, the behavioral vector $\mathbf{B}$ is passed through a decorrelation transform $\mathcal{T}: \mathbb{R}^{d_B} \rightarrow \mathbb{R}^{d_B}$ that whitens the feature space:

$$
\tilde{\mathbf{B}} = \mathcal{T}(\mathbf{B}) = \mathbf{W} \mathbf{B}
$$

where $\mathbf{W} \in \mathbb{R}^{d_B \times d_B}$ is a whitening matrix satisfying $\mathbf{W} \boldsymbol{\Sigma}_B \mathbf{W}^T = \mathbf{I}_{d_B}$.

#### 2.6.3 Candidate Transforms

Three decorrelation strategies are evaluated:

| Transform | Whitening Matrix $\mathbf{W}$ | Complexity | Security Property |
|-----------|------------------------------|------------|-------------------|
| ZCA Whitening | $\mathbf{W}_{\text{ZCA}} = \boldsymbol{\Sigma}_B^{-1/2}$ | $\mathcal{O}(d_B^3)$ | Preserves original feature orientation |
| Lean Walsh Transform with Random Sign Diagonal | $\mathbf{W}_{\text{LWT}} = \mathbf{D} \mathbf{H}_{\text{Walsh}}$, $D_{ii} \sim \{-1, +1\}$ | $\mathcal{O}(d_B \log d_B)$ | Cancelable; random sign diagonal prevents inversion |
| Localized PCA | $\mathbf{W}_{\text{PCA}} = \boldsymbol{\Lambda}^{-1/2} \mathbf{V}^T$ | $\mathcal{O}(d_B^3)$ | Maximizes variance separation |

#### 2.6.4 Recommendation

The Lean Walsh Transform with random sign diagonal is preferred for its $\mathcal{O}(d_B \log d_B)$ complexity and cancelable security properties. The random sign diagonal $\mathbf{D}$ ensures that even if $\mathbf{H}_{\text{Walsh}}$ is known, the transform remains non-invertible without $\mathbf{D}$. The decorrelated vector $\tilde{\mathbf{B}}$ is then passed to the SRP-LSH step:

$$
w_i = \mathbb{I}[\mathbf{r}_i \cdot \tilde{\mathbf{B}} \geq 0]
$$

This ensures that each bit $w_i$ carries approximately 1 bit of min-entropy, maximizing the information density of the resulting $k$-bit string.

---

## 3. Stabilization via Fuzzy Commitment (Juels-Wattenberg)

### 3.1 Overview

To enable the OAuth provider (sal-auth) to output an exact, immutable identity string across separate user sessions without storing local tracking cookies, the protocol implements a Fuzzy Commitment Scheme [30]. This key-binding biometric cryptosystem secures a stable cryptographic key within an error-correcting framework, ensuring that intra-class variations in the user's behavioral profile are mathematically corrected [2].

### 3.2 Error-Correcting Code Specification

The error-correcting pipeline utilizes a Bose-Chaudhuri-Hocquenghem (BCH) code over the Galois Field $\mathbb{F}_{2^m}$, where $n$ is the block length, $k$ is the message dimension, and $t$ is the maximum correctable bit-error threshold [8]:

$$
\mathcal{C}_{\text{BCH}}(n, k, t) \subset \mathbb{F}_2^n
$$

### 3.3 Enrollment Phase (First Visit)

1. The client captures the composite feature vector $\mathbf{X}$ and generates the initial noisy biometric bit-string $\mathbf{w}$ [26].

2. The authentication server randomly selects a canonical identity codeword $\mathbf{c} \in \mathcal{C}_{\text{BCH}}$ from the codebook $\mathcal{C}$ [32].

3. The server computes a public blinding factor (the commitment token) $\boldsymbol{\delta}$ by performing a bitwise XOR operation [10]:

$$
\boldsymbol{\delta} = \mathbf{w} \oplus \mathbf{c}
$$

4. The server stores the blinding factor $\boldsymbol{\delta}$ within a Neo4j graph database, linking it directly to the initial visitor node [31].

5. The canonical codeword is securely processed using a one-way cryptographic hash function to store $H(\mathbf{c})$ as a verification anchor [8].

**Crucially**, neither the raw biometric vector $\mathbf{X}$ nor the biometric bit-string $\mathbf{w}$ is ever written to disk [4].

### 3.4 Authentication Phase (Returning Visit)

1. The returning user initiates a session, prompting the system to capture a new, noisy biometric vector $\mathbf{X}'$ and generate a fresh query bit-string $\mathbf{w}'$ [10].

2. The server retrieves the historic blinding factor $\boldsymbol{\delta}$ from the Neo4j database and extracts a noisy representation of the original codeword $\mathbf{c}'$ [10]:

$$
\mathbf{c}' = \mathbf{w}' \oplus \boldsymbol{\delta}
$$

3. The term $\mathbf{e} = \mathbf{c}' \oplus \mathbf{c}$ represents the error vector introduced by behavioral and physical noise between the two sessions [9].

4. The server passes $\mathbf{c}'$ into the algebraic decoding pipeline:

$$
\hat{\mathbf{c}} = \text{Decode}_{\text{BCH}}(\mathbf{c}')
$$

5. If the behavioral drift is within the error threshold of the BCH codebook, satisfying the Hamming distance constraint $d_H(\mathbf{c}', \mathbf{c}) \leq t$, the decoder corrects the error vector [10]. The algebraic code snaps $\mathbf{c}'$ back to the exact canonical codeword:

$$
\hat{\mathbf{c}} = \mathbf{c}
$$

6. The server computes the hash of the decoded output and verifies that $H(\hat{\mathbf{c}}) = H(\mathbf{c})$ [8]. If verified, the exact canonical codeword $\mathbf{c}$ is released, and access is granted [2].

```
                     Authentication Pipeline
  Query Bit-string w' ──┐
                        ├─> (w' ⊕ δ) ──> Noisy Codeword c' ──> Decode_BCH ──> Verified c
  Blinding Factor δ  ──┘                                        (If d_H ≤ t)
```

### 3.5 Advanced Error Correction

To handle non-linear noise in unconstrained real-world scenarios, the pipeline is enhanced using:

- **Adaptive quantization**: Such as AdaMTrans
- **Deep learning-based error correction**: Such as a Neural Min-Sum LDPC decoder [10]

These advanced decoders dramatically improve noise tolerance while preserving the entropy bounds of the underlying cryptographic keys [10].

---

## 4. The BBES Mapping Function (Bits to Braille)

### 4.1 Overview

Once the canonical codeword $\mathbf{c}$ is successfully recovered and cryptographically verified, it must be mapped to a human-readable, visually auditable identifier on the user's dashboard. The Biometric/Behavioral Encryption Standard (BBES) maps the codeword to the Unicode Braille Patterns block (U+2800 to U+28FF). Because each 8-dot Braille cell natively represents exactly 1 byte ($2^8 = 256$ possibilities), it provides an exceptionally dense and deterministic visualization of binary entropy [34].

### 4.2 Byte Segmentation

The canonical bitstring $\mathbf{c}$ is divided into a sequence of $m$ bytes, where each byte $b_j$ for $j \in \{1, \ldots, m\}$:

$$
\mathbf{c} = b_1 \| b_2 \| \cdots \| b_m, \quad b_j \in \{0, 1\}^8
$$

### 4.3 Bit-to-Dot Mapping

The individual bits of $b_j$ map directly to the standardized ISO/IEC 15924 Braille dot numbering grid:

```
  (Bit 0) Dot 1  ⠿  Dot 4 (Bit 3)
  (Bit 1) Dot 2  ⠿  Dot 5 (Bit 4)
  (Bit 2) Dot 3  ⠿  Dot 6 (Bit 5)
  (Bit 6) Dot 7  ⠿  Dot 8 (Bit 7)
```

### 4.4 Mathematical Mapping Function

The mathematical mapping function $\mathcal{M}_{\text{BBES}}: \{0, 1\}^8 \rightarrow \text{U+2800--U+28FF}$ maps each byte to its corresponding Unicode scalar point:

$$
\mathcal{M}_{\text{BBES}}(b_j) = \text{U+2800} + \sum_{i=0}^{7} b_{j,i} \cdot 2^i
$$

### 4.5 Signature Generation

- For a 64-bit canonical key, the mapping yields an elegant, exactly deterministic 8-character Braille signature (e.g., ⣾⣄⠹⢟⣓⠆⡧⣠).
- For a highly secure 128-bit key, the mapping generates a 16-character Braille signature.

This signature serves as a highly deterministic, visually verifiable representation of the user's hardened biometric identity.

---

## 5. Entropy, Uniqueness, and Collision Bounds

### 5.1 Collision Probability Analysis

To validate the security posture of the BBID protocol for enterprise authentication, its collision resistance must be analyzed under the Birthday Paradox. Let $N$ be the active user population size, and $K = 2^k$ be the total available keyspace, where $k$ is the number of active message bits in the canonical codeword $\mathbf{c}$ [2]. The probability of at least one identity collision $P(\text{collision})$ within the system is bounded by:

$$
P(\text{collision}) \approx 1 - \exp\left(-\frac{N(N-1)}{2K}\right) \approx 1 - \exp\left(-\frac{N^2}{2^{k+1}}\right)
$$

Because the Fuzzy Commitment Scheme binds the high-dimensional biometric vector to a strict, error-corrected codeword space, the effective entropy of the final token is defined entirely by the message length $k$ of the code, not the raw dimension $D$ of the biometric input [2].

### 5.2 Collision Risk Profiles

The table below illustrates the collision risk profiles of various cell configurations across different population scales.

| Braille Signature Length | Available Bits (k) | Population (N) | Collision Risk P(collision) | Operational Security Classification |
|--------------------------|--------------------|----------------|------------------------------|-------------------------------------|
| 8 Cells | 64 bits | $10^3$ ($\approx 2^{10}$) | $\approx 2^{-43}$ | Secure Proof-of-Concept |
| 8 Cells | 64 bits | $10^9$ ($\approx 2^{30}$) | $\approx 2^{-3}$ | Degraded / Operational Collision Risk |
| 16 Cells | 128 bits | $8 \times 10^9$ ($\approx 2^{33}$) | $\approx 2^{-62}$ | Planetary-Scale Cryptographic Uniqueness [36] |

### 5.3 Security Recommendation

By transitioning to a 16-cell Braille signature (providing 128 bits of cryptographic entropy), the BBID protocol completely eliminates collision vectors across the entire population of the planet [36]. This holds true even when allowing for a $t$-bit error correction margin in the behavioral biometric layer, transforming the sal-auth codebase from a high-risk probabilistic matching engine into a highly deterministic, noise-insulated biometric identity protocol [1].

---

## 6. Architectural Resolution of the Projection Seeding Dilemma

### 6.1 The Challenge

A key architectural challenge in implementing the Signed Random Projection LSH step is the generation, distribution, and preservation of the random hyperplanes $\mathcal{R}$ [13]. Because LSH requires that the exact same projection hyperplanes be used during both enrollment and authentication to preserve angular distances, the seeding mechanism is a critical security boundary [6].

### 6.2 Threats to Random Projection Integrity

#### 6.2.1 Model Inversion and Reconstruction Attacks

In a model inversion attack, an adversary compromises the database and attempts to reconstruct the original continuous biometric vector $\mathbf{B}$ from the stored templates [5]. Standard neural network-based embeddings are highly susceptible to these attacks [5].

In a deep hashing or LSH framework, if the adversary has black-box query access or knows the projection hyperplanes $\mathcal{R}$, they can train surrogate generative models or use diffusion-based denoising frameworks (such as DHMI) to reconstruct highly realistic original biometric inputs, leading to permanent identity compromise [5].

```
  Leaked Hash Code w ──> Surrogate Model / DHMI ──> Reconstructed Biometrics X*
                                 ▲
  Public Hyperplanes R ──────────┘                                   (Vulnerable to DHMI) [40, 41]
```

#### 6.2.2 Pseudo-Inverse and Full-Rank Inversion Attacks

If the projection matrix $\mathbf{R}$ is public or statically known, an attacker exploits the distance-preserving properties of the projection to construct a set of pseudo-inverses [26]. The attacker then applies optimization algorithms to select a set of probable neighbors from independent public datasets and linearly composes an estimate $\hat{\mathbf{B}}$ of the genuine vector $\mathbf{B}$ [26].

Furthermore, if a user's biometrics are projected using $m$ different projection matrices $\mathbf{R}^{(1)}, \mathbf{R}^{(2)}, \ldots, \mathbf{R}^{(m)}$ across different applications, and an attacker compromises these databases, they can horizontally concatenate the projection matrices [26]:

$$
\mathbf{R}_{\text{concat}} = \begin{bmatrix} \mathbf{R}^{(1)} \\ \mathbf{R}^{(2)} \\ \vdots \\ \mathbf{R}^{(m)} \end{bmatrix}
$$

Once $\text{rank}(\mathbf{R}_{\text{concat}}) = d_B$, the concatenated matrix achieves full rank, making the linear projection completely reversible and exposing the raw biometric data [26]. This is known as the Attack via Record Multiplicity (ARM) [6].

### 6.3 Seeding Architectures

#### 6.3.1 Option A: Client-Side Static Bundling

In this model, the projection seed and hyperplane generation code are packaged directly inside the client application (e.g., compiled into WebAssembly or a JavaScript bundle).

- **Vulnerability**: This approach violates basic Zero Trust principles [1]. Because client-side code is execution-exposed, any static seed or hardcoded matrix is extractable by an attacker using standard debugging and memory inspection tools [14].
- **Implications**: Once the seed is compromised, the hyperplanes $\mathcal{R}$ for all users are exposed [26]. This allows attackers to perform pseudo-inverse estimation, mount ARM attacks across different applications, and reconstruct the raw hardware/behavioral templates of the entire user base [6].

#### 6.3.2 Option B: Dynamic Serving via Cloudflare Worker

In this model, the projection matrices are generated on-the-fly by an edge-computing instance (e.g., a Cloudflare Worker) upon session initialization.

- **Usability Failure**: If the Worker generates entirely random, ephemeral hyperplanes $\mathcal{R}_{\text{new}}$ for every individual session, the system's usability collapses. Because LSH requires the exact same projection hyperplanes during both enrollment and authentication to preserve angular distance, a completely random, non-persistent matrix makes it impossible for a returning user to snap back to their canonical codeword $\mathbf{c}$ [6].
- **Vulnerability**: Alternatively, storing a unique projection matrix $\mathcal{R}_u$ for every user in a centralized database introduces significant key management overhead, scales poorly, and recreates the exact tracking and security concerns associated with storing raw biometric templates [26].

### 6.4 Proposed Architecture: Edge-Derived Deterministic User-Specific Projection (ED-DUP)

To resolve these vulnerabilities while maintaining a zero-cookie, zero-local-storage architecture, the BBID protocol implements an Edge-Derived Deterministic User-Specific Projection (ED-DUP) paradigm [38]. This approach leverages a Cloudflare Worker acting as a Zero Trust security gateway [1]. It derives user-specific, cryptographically isolated projection hyperplanes on-the-fly, ensuring they are never stored persistently or exposed globally [9].

The architecture operates via a multi-layered cryptographic pipeline:

#### 6.4.1 Step 1: Secure Identifier Retrieval

When a user initiates a session, they submit a public identifier (such as a username or public node ID) [31]. The Cloudflare Worker queries the Neo4j graph database to verify the node's existence and retrieves the user-specific salt $s_u$ and template version parameter $v_u$ [31].

#### 6.4.2 Step 2: Key Derivation Function (KDF) Pipeline

Rather than using static keys, the Worker utilizes an HMAC-based Key Derivation Function (HKDF-SHA256) to compute an algebraically secure, user-specific seed [43]. This process is driven by a high-entropy Master System Secret ($M_{\text{sys}}$) stored securely in the Worker's encrypted environment variables or a hardware-bound Trusted Execution Environment (TEE) [9]:

$$
\text{seed}_u = \text{HKDF-SHA256}(M_{\text{sys}}, \text{info} = \text{ID}_u \| s_u \| v_u)
$$

By binding the user's public identifier $\text{ID}_u$ and the version parameter $v_u$ into the derivation path, the system ensures that every user is assigned a completely unique, mathematically isolated projection space [43]. If a user's template is compromised, the server simply increments the version parameter ($v_u \leftarrow v_u + 1$), instantly deriving a new, uncorrelated projection matrix $\mathcal{R}'_u$, thereby achieving clean revocability [15].

#### 6.4.3 Step 3: Deterministic Hyperplane Expansion

The derived user-specific seed $\text{seed}_u$ is loaded into a cryptographically secure Deterministic Random Bit Generator (DRBG) configured in AES-CTR mode. This DRBG expands the 256-bit seed into the full dimensionality of the random hyperplanes $\mathcal{R}_u$ required for the LSH step:

$$
\mathcal{R}_u = \text{DRBG}_{\text{AES-CTR}}(\text{seed}_u) \in \mathbb{R}^{k \times d_B}
$$

To ensure algebraic correctness and prevent modular bias during hyperplane generation, the seed generation is validated using a symbolic modular inversion mapping over a prime modulus $p$ [46]:

$$
\text{seed}_u' = \text{ModInv}(\text{seed}_u, p), \quad p = 3^m
$$

This enforces cycle-complete, structurally robust pseudorandom outputs that are highly resilient to side-channel leakage [46].

#### 6.4.4 Step 4: Ephemeral Execution and Bandwidth Optimization

To minimize network overhead and latency, the Cloudflare Worker does not transmit the generated hyperplanes $\mathcal{R}_u$ across the network. Instead, the Worker transmits only the derived 256-bit seed $\text{seed}_u$ to the client over an encrypted TLS channel.

The client-side environment runs a lightweight WebAssembly-compiled execution of the same AES-CTR-DRBG, expanding $\text{seed}_u$ into the identical projection matrix $\mathcal{R}_u$ locally in ephemeral memory. The user's biometric vector $\mathbf{B}$ is projected locally, producing the bitstring $\mathbf{w}$ [26].

Once the projection is complete, $\mathcal{R}_u$ and $\text{seed}_u$ are immediately zeroed out in the client's memory. The raw biometric features never leave the local environment [43]. Only the non-reversible, locality-preserved bitstring $\mathbf{w}$ (or the blinding factor $\boldsymbol{\delta}$) is transmitted to the server, satisfying the principle of least privilege in Zero Trust architectures [1].

### 6.5 Comparative Security Analysis

To evaluate the operational and security trade-offs of the ED-DUP model, the table below compares it against standard seeding architectures.

| Security & Architectural Metric | Client-Side Static Bundle | Naive Dynamic Server (Cloudflare Worker) | Edge-Derived Deterministic User-Specific Projection (ED-DUP) |
|---------------------------------|---------------------------|------------------------------------------|---------------------------------------------------------------|
| Vulnerability to Reverse Engineering [14] | High: Static binaries can be decompiled, exposing the global seed [14] | Low: Hyperplanes are generated in the server TEE, but transmission costs are high [9] | None: Master secret is protected within the Cloudflare Worker TEE [9] |
| Cross-Matching Vulnerability [24] | High: Identical global hyperplanes allow cross-matching of compromised tokens [6] | None: Ephemeral generations are unique but break biometric matching [6] | Absolute Protection: Deterministic, user-specific keyspaces prevent cross-matching [26] |
| Vulnerability to ARM Attacks [6] | High: Multiple databases can be concatenated into a full-rank linear system [26] | Low: Mitigated, but introduces database scaling bottlenecks [26] | Immune: Non-correlated user-specific hyperplanes prevent linear equation concatenation [6] |
| Usability / Compatibility [10] | High: Local generation is fast and consistent across logins | Zero: Non-deterministic ephemeral states make user authentication impossible [6] | High: Deterministic client-side expansion enables consistent local projection [43] |
| Revocability Support [15] | Low: Requires re-compiling and distributing new client binaries [15] | Complex: Requires manual key database updates and synchronization [26] | Instantaneous: Server-side increment of version parameter $v_u$ regenerates $\mathcal{R}_u$ [15] |

---

## 7. Operational Deployment Recommendations

To implement this cryptographically hardened protocol within the sal-auth pipeline [31], the following architectural integrations must be executed:

### 7.1 Database Schema Integration

Define the visitor node schema in Neo4j to store:
- The public blinding factor $\boldsymbol{\delta}$
- The salt $s_u$
- The version integer $v_u$
- The SHA-256 validation anchor $H(\mathbf{c})$ [30]

**No raw biometric parameters are permitted within the database** [34].

### 7.2 Edge Worker Key Derivation Configuration

Provision the Cloudflare Worker with a cryptographically secure, hardware-backed environment variable to store the master secret $M_{\text{sys}}$. Program the Worker to compute the HKDF-SHA256 derivation path dynamically upon verifying the client's identity [43].

### 7.3 Wasm Client Projection Engine

Implement a client-side WebAssembly library containing:
- Optimized AES-CTR-DRBG expansion engine
- Capability to receive the 32-byte seed $\text{seed}_u$ from the Worker over TLS
- Expand $\text{seed}_u$ to the projection matrix $\mathcal{R}_u$
- Project the locally measured vector $\mathbf{B}$
- Immediately zero out the memory allocated to both $\mathcal{R}_u$ and $\text{seed}_u$ to prevent physical template leakage [43]

---

## 8. Recovery and Re-Enrollment Protocol

### 8.1 The Behavioral Drift Problem

Legitimate, long-term behavioral drift presents a fundamental challenge to the zero-storage architecture. When a user switches from a desktop keyboard to a mobile touchscreen, sustains a hand injury, or undergoes natural motor adaptation, the Hamming distance between the enrolled bitstring $\mathbf{w}$ and the query bitstring $\mathbf{w}'$ may permanently exceed the BCH error correction threshold $t$:

$$
d_H(\mathbf{w}, \mathbf{w}') > t \implies \Decode_{\text{BCH}}(\mathbf{w}' \oplus \boldsymbol{\delta}) \neq \mathbf{c}
$$

Under a strict zero-storage architecture, the user is locked out with no recovery path, as the system stores neither passwords, recovery keys, nor out-of-band contact methods.

### 8.2 Recovery Threat Model

Recovery mechanisms must satisfy three constraints:

1. **No tracking vector reintroduction**: Recovery must not create persistent identifiers that undermine the zero-cookie architecture.
2. **No raw biometric storage**: Recovery must not store $\mathbf{X}$, $\mathbf{w}$, or $\mathbf{B}$ as fallback templates.
3. **Cryptographic continuity**: The recovered identity must bind to the same canonical codeword $\mathbf{c}$ to preserve the user's established identity graph.

### 8.3 Multi-Tier Recovery Architecture

#### 8.3.1 Tier 1: Graceful Tolerance Widening

When authentication fails with $d_H(\mathbf{w}, \mathbf{w}') \in (t, t + \Delta]$, the server temporarily widens the tolerance window:

$$
t_{\text{effective}} = t + \Delta, \quad \Delta \in \mathbb{N}
$$

If $d_H(\mathbf{w}, \mathbf{w}') \leq t + \Delta$, authentication succeeds. The server then triggers a silent re-enrollment:

$$
\boldsymbol{\delta}_{\text{new}} = \mathbf{w}' \oplus \mathbf{c}
$$

updating the blinding factor to reflect the user's new behavioral baseline. The tolerance window $\Delta$ is bounded by the code's minimum distance to prevent cross-user collision:

$$
\Delta < d_{\min}(\mathcal{C}_{\text{BCH}}) - t
$$

#### 8.3.2 Tier 2: Hardware Subspace Fallback

If behavioral drift exceeds $t + \Delta$, the system falls back to the hardware subspace $\mathbf{H}$ as a secondary identity signal. The hardware bitstring $\mathbf{w}_H$ is computed via a separate SRP-LSH projection:

$$
\mathbf{w}_H = h_{\text{SRP}}(\mathbf{H})
$$

If $d_H(\mathbf{w}_H, \mathbf{w}_H^{\text{enrolled}}) \leq t_H$, the hardware subspace alone authenticates the user, triggering behavioral re-enrollment. This fallback is only available in deployment tiers where $\|\boldsymbol{\Sigma}_H\|$ is bounded (see Section 1.5.2).

#### 8.3.3 Tier 3: Progressive Re-Enrollment

When both behavioral and hardware signals fail, the user enters a progressive re-enrollment phase:

1. The system collects $m$ consecutive behavioral samples $\{\mathbf{B}_1, \mathbf{B}_2, \ldots, \mathbf{B}_m\}$ over a session.
2. A consensus bitstring is computed via majority voting:

$$
\mathbf{w}_{\text{consensus}}[i] = \text{majority}\left(\{h_{\text{SRP}}(\mathbf{B}_j)[i]\}_{j=1}^{m}\right)
$$

3. The consensus bitstring is compared against the enrolled $\mathbf{w}$ with a relaxed threshold $t_{\text{progressive}} > t$.
4. If matched, the blinding factor is updated and the version parameter is incremented:

$$
v_u \leftarrow v_u + 1, \quad \boldsymbol{\delta}_{\text{new}} = \mathbf{w}_{\text{consensus}} \oplus \mathbf{c}
$$

#### 8.3.4 Tier 4: Out-of-Band Recovery (Last Resort)

As a last resort, the system supports out-of-band recovery without reintroducing persistent tracking:

- **One-time recovery token**: A single-use, time-limited token is delivered via email or SMS. The token authorizes exactly one re-enrollment operation and is immediately invalidated.
- **Social recovery**: A quorum of $q$ trusted contacts (pre-established during enrollment) collectively authorize re-enrollment via threshold signatures.
- **Hardware token**: A physical security key (FIDO2/WebAuthn) serves as a recovery authenticator, bound to the user's identity graph but not used for routine authentication.

### 8.4 Version Rotation Protocol

When re-enrollment is triggered (via any tier), the version parameter is incremented atomically:

$$
v_u \leftarrow v_u + 1
$$

This immediately derives a new projection matrix $\mathcal{R}'_u$ via the HKDF pipeline (Section 6.4.2), ensuring:

1. The old projection matrix $\mathcal{R}_u$ is cryptographically severed from the new identity.
2. Any compromised old templates become useless.
3. The user's identity graph in Neo4j preserves continuity via the same node ID.

### 8.5 Security Analysis of Recovery Tiers

| Recovery Tier | Tracking Vector Risk | Usability Friction | Security Degradation |
|---------------|---------------------|-------------------|---------------------|
| Tier 1: Tolerance Widening | None | Zero | Minimal ($\Delta$-bit entropy reduction) |
| Tier 2: Hardware Fallback | None (if $\|\boldsymbol{\Sigma}_H\|$ bounded) | Zero | Moderate (hardware-only auth) |
| Tier 3: Progressive Re-Enrollment | None | Low (extended session) | Moderate (relaxed threshold) |
| Tier 4: Out-of-Band Recovery | Transient (one-time token) | High (user action required) | High (bypasses biometric binding) |

### 8.6 Recommendation

Tiers 1-3 provide zero-friction recovery for gradual and moderate behavioral drift without introducing tracking vectors. Tier 4 is reserved for catastrophic drift events (device loss, severe injury) and is gated by rate-limiting, audit logging, and mandatory post-recovery re-enrollment.

---

## 9. Appendix: Unsupervised Behavioral Inference and Privacy Implications

### 9.1 Theoretical Framework for Demographic Inference

While the BBID protocol is intentionally designed for identity verification rather than demographic profiling, it is important to acknowledge the theoretical possibility of inferring physical or demographic attributes from behavioral biometric data through unsupervised learning techniques. This appendix examines the technical feasibility, mathematical foundations, and privacy implications of such inference.

### 9.2 Covariance Structure and Demographic Correlation

The stochastic behavioral subspace $\mathbf{B}$ is governed by a multivariate Gaussian distribution with covariance matrix $\boldsymbol{\Sigma}$:

$$
\mathbf{X}_i = \mathbf{X}_j + \boldsymbol{\epsilon}, \quad \boldsymbol{\epsilon} \sim \mathcal{N}(\mathbf{0}, \boldsymbol{\Sigma})
$$

Research in keystroke dynamics and behavioral biometrics has demonstrated that the covariance structure $\boldsymbol{\Sigma}$ may exhibit statistically significant differences across demographic groups. Specifically:

- **Gender differences**: Studies have identified 5-15% statistically significant differences in mean flight times, variance patterns, and correlation structures between male and female typing patterns
- **Anthropometric correlations**: Finger length, hand size, and reach patterns directly influence key reach kinematics, producing distinct timing distributions
- **Age-related variation**: Motor control precision and typing experience introduce age-dependent variance in behavioral features

The correlation matrix $\mathbf{C} = \text{diag}(\boldsymbol{\Sigma})^{-1/2} \boldsymbol{\Sigma} \text{diag}(\boldsymbol{\Sigma})^{-1/2}$ may fundamentally differ between demographic groups, suggesting that unsupervised clustering could reveal natural groupings in behavioral space.

### 9.3 Unsupervised Learning Approaches

Without requiring labeled training data, several unsupervised techniques could theoretically discover latent demographic structure:

#### 9.3.1 k-Means Clustering

The k-means algorithm partitions the feature space $\mathbb{R}^D$ into $k$ clusters by minimizing within-cluster variance:

$$
\arg\min_{\mathbf{S}} \sum_{i=1}^{k} \sum_{\mathbf{x} \in S_i} \|\mathbf{x} - \boldsymbol{\mu}_i\|^2
$$

where $S_i$ is the set of points in cluster $i$ and $\boldsymbol{\mu}_i$ is the cluster centroid. This could reveal natural groupings corresponding to hand size, typing experience, or other anthropometric factors.

#### 9.3.2 Gaussian Mixture Models (GMM)

GMM extends k-means by modeling the data as a mixture of Gaussian distributions with cluster-specific covariance matrices:

$$
P(\mathbf{x}) = \sum_{i=1}^{k} \pi_i \mathcal{N}(\mathbf{x} | \boldsymbol{\mu}_i, \boldsymbol{\Sigma}_i)
$$

This allows for overlapping clusters with different covariance structures, potentially capturing the nuanced behavioral variations between demographic groups more effectively than k-means.

#### 9.3.3 Density-Based Spatial Clustering (DBSCAN)

DBSCAN identifies clusters as dense regions separated by sparse regions, requiring no prior specification of $k$:

$$
\text{Cluster} = \{\mathbf{x} \mid \text{density}(\mathbf{x}) \geq \epsilon \text{ and connected via density-reachable points}\}
$$

This approach could discover natural groupings without imposing spherical cluster assumptions, potentially revealing more complex behavioral manifolds.

#### 9.3.4 Spectral Clustering

Spectral clustering leverages the eigenstructure of the similarity matrix to perform dimensionality reduction before clustering:

$$
\mathbf{L} = \mathbf{D} - \mathbf{W}, \quad \text{where } W_{ij} = \exp\left(-\frac{\|\mathbf{x}_i - \mathbf{x}_j\|^2}{2\sigma^2}\right)
$$

This could capture non-linear manifold structures in behavioral space that linear methods might miss.

### 9.4 Finger Length Inference Feasibility

Among potential demographic inferences, finger length estimation is more technically feasible than gender classification for the following reasons:

**Mechanical linkage**: Finger length directly determines:
- Key reach patterns and inter-key transition distances
- Flight time distributions for specific key pairs
- Force/pressure profiles (if keyboard supports pressure sensing)
- Hand posture and ergonomic adaptation patterns

**Research validation**: Studies in keystroke dynamics have demonstrated correlations between:
- Hand anthropometry and typing kinematics
- Finger span and inter-key timing variance
- Reach distance and flight time distributions

**Mathematical formulation**: Given a feature vector $\mathbf{B}$ containing key-pair specific flight times, one could model finger length $L$ as a latent variable:

$$
\mathbf{B} = f(L, \boldsymbol{\eta}) + \boldsymbol{\epsilon}, \quad \boldsymbol{\epsilon} \sim \mathcal{N}(\mathbf{0}, \boldsymbol{\Sigma})
$$

where $f(\cdot)$ is a non-linear mapping from finger length to behavioral features and $\boldsymbol{\eta}$ represents confounding variables (experience, age, keyboard type).

### 9.5 Technical Challenges and Limitations

Several significant challenges limit the practical accuracy of unsupervised demographic inference:

1. **Feature space dimensionality**: The current BBID specification defines the composite feature vector $\mathbf{X} \in \mathbb{R}^D$ where $D = d_H + d_B$. The deterministic hardware subspace $\mathbf{H}$ comprises canvas rendering outputs, WebGL constants, CPU configurations, screen geometry, and optional silicon biometrics (PUF, PPA). The stochastic behavioral subspace $\mathbf{B}$ comprises keystroke dynamics, mouse kinematics, scroll entropy, and touch gesture metrics. For implementations following the specification, $D$ is typically less than 50. For unsupervised demographic clustering to achieve statistically significant cluster separation, higher-dimensional feature spaces ($D \gg 100$) would be required.

2. **Sample size requirements**: Stable cluster structure requires $N \gg 1000$ users to overcome the curse of dimensionality and achieve statistical significance.

3. **Cluster overlap**: Behavioral clusters exhibit significant overlap due to confounding variables (age, experience, keyboard type, ergonomic setup), reducing classification accuracy.

4. **Confounding variables**: Typing experience, physical disabilities, keyboard layout, and environmental factors introduce variance that masks demographic signals.

5. **Non-stationarity**: Behavioral patterns change over time due to fatigue, learning, and adaptation, complicating cluster stability.

### 9.6 Privacy Implications and BBID Design Philosophy

The BBID protocol intentionally avoids demographic inference for several critical reasons:

**Privacy-by-design**: The system is designed to verify identity, not profile users. Adding unsupervised clustering would reveal the very information the protocol aims to protect.

**Regulatory compliance**: Demographic inference from behavioral data may violate privacy regulations (GDPR, CCPA) depending on jurisdiction and implementation context.

**Adversarial risk**: If demographic inference is possible, adversaries could exploit the same techniques for surveillance, discrimination, or social engineering attacks.

**Trust erosion**: User trust depends on the understanding that the system only uses behavioral data for identity verification, not demographic profiling.

### 9.7 Mitigation Strategies

To prevent unsupervised demographic inference while maintaining identity verification capability:

1. **Feature dimensionality reduction**: Use random projection to reduce $D$ to a dimension where demographic signals are lost but identity signals remain.

2. **Differential privacy**: Add calibrated noise to behavioral features to obscure demographic structure while preserving identity verification accuracy.

3. **Adversarial debiasing**: Train the projection matrix to minimize demographic information leakage while maximizing identity discrimination.

4. **Feature selection**: Exclude features with high demographic correlation (e.g., specific key-pair flight times that correlate strongly with hand size).

5. **Covariance regularization**: Apply regularization to $\boldsymbol{\Sigma}$ to prevent overfitting to demographic patterns during model training.

### 9.8 Conclusion

While unsupervised learning techniques could theoretically reveal demographic structure in behavioral biometric data—particularly for anthropometric attributes like finger length—the BBID protocol explicitly avoids this capability through architectural design choices. The privacy-preserving nature of the system is not merely a limitation of current implementation, but a fundamental design principle that distinguishes BBID from surveillance-oriented behavioral analysis systems.

Future research should focus on quantifying the trade-off between identity verification accuracy and demographic leakage, developing provable privacy guarantees for behavioral biometric systems, and establishing standards for acceptable feature extraction in privacy-preserving authentication protocols.

---

## 10. Appendix: Behavioral Deepfakes and Adversarial Cloning of the Behavioral Subspace

### 10.1 Threat Model: The Behavioral Deepfake

A critical security consideration for any behavioral biometric system is the adversarial synthesis of human-like behavior. If an attacker trains a sequence-to-sequence generative model (transformer, diffusion network, or GAN) on a target user's behavioral data, they construct a **behavioral deepfake**—an AI system that synthesizes the user's stochastic behavioral subspace $\mathbf{B}$ with sufficient fidelity to pass biometric authentication.

This attack vector is distinct from traditional credential theft or template reconstruction. The adversary does not steal a static secret; they clone the dynamic process that generates the secret.

### 10.2 Transformer Architecture for Behavioral Cloning

#### 10.2.1 Keystroke Dynamics Synthesis

A transformer models the temporal distribution of keystroke events as a sequence-to-sequence problem. Given a dataset of key-pair specific flight times $\{t_{ij}\}$ for key transitions $i \rightarrow j$, the model learns the user's log-normal latency distribution:

$$
P(\Delta t \mid k_i, k_j) \sim \text{LogNormal}(\mu_{ij}, \sigma_{ij}^2)
$$

The transformer captures higher-order dependencies that naive statistical models miss:
- **Digraph-specific timing**: Transition from "T" to "H" exhibits different latency than "A" to "X"
- **Cognitive pause modeling**: Increased latency before punctuation, clause boundaries, and sentence completion
- **Rhythm preservation**: Long-range temporal consistency across typing bursts

#### 10.2.2 Mouse Trajectory Generation

For mouse movement synthesis, diffusion networks or GANs generate trajectories that satisfy Fitts' Law:

$$
T = a + b \log_2\left(\frac{2D}{W}\right)
$$

where $T$ is movement time, $D$ is distance to target, and $W$ is target width. The generated trajectories exhibit:
- **Organic acceleration curves**: Rapid initial movement, deceleration near target
- **Micro-corrections**: Overshoot followed by small adjustments before clicking
- **Natural hand jitter**: High-frequency noise consistent with human motor control

#### 10.2.3 Formal Cloning Objective

Let $\mathcal{D} = \{(\mathbf{B}_1, \mathbf{B}_2, \ldots, \mathbf{B}_T)\}$ be a dataset of behavioral sequences from the target user. The transformer is trained to minimize:

$$
\mathcal{L} = -\sum_{t=1}^{T} \log P_\theta(\mathbf{B}_t \mid \mathbf{B}_{<t}, \mathbf{c})
$$

where $\mathbf{c}$ is a conditioning context (intended action, target element, text to type) and $\theta$ are the model parameters. At convergence, the synthesized behavioral stream $\hat{\mathbf{B}}$ satisfies:

$$
D_{\text{KL}}(P_{\text{user}}(\mathbf{B}) \| P_\theta(\hat{\mathbf{B}})) < \epsilon
$$

for some small $\epsilon > 0$, where $D_{\text{KL}}$ is the Kullback-Leibler divergence.

### 10.3 The Infrastructure Gap: Why Behavioral Cloning Alone Fails

Even with perfect behavioral synthesis, the cloned behavior must be executed through a browser automation framework. This introduces detectable artifacts at the infrastructure layer:

#### 10.3.1 Browser Environment Leakage

Automation frameworks expose detectable signals to the page's JavaScript environment:

- **WebDriver detection**: `navigator.webdriver === true` in Chromium-based automation
- **CDP side-channels**: Chrome DevTools Protocol artifacts detectable by anti-bot scripts
- **Property enumeration anomalies**: Missing or modified native browser properties

#### 10.3.2 Network Fingerprinting

The automation framework's network stack introduces detectable signatures independent of behavioral patterns:

- **TLS fingerprinting (JA4)**: The TLS handshake signature of the automation runtime differs from standard browsers
- **HTTP/2 frame patterns**: Automated traffic exhibits distinct multiplexing and prioritization patterns
- **WebSocket behavior**: Connection establishment and message framing patterns differ from human-driven browsers

#### 10.3.3 Hardware Subspace Inconsistency

The transformer clones $\mathbf{B}$ but cannot clone $\mathbf{H}$. The hardware subspace reported by the automation environment will differ from the user's genuine device fingerprint, creating a detectable mismatch:

$$
\mathbf{H}_{\text{automation}} \neq \mathbf{H}_{\text{user}}
$$

### 10.4 The Perfect Digital Double Stack

To achieve total mimicry that defeats both behavioral and architectural verification, the adversary must combine:

```
 ┌──────────────────────────────────────┐
 │       GENERATIVE AI LAYER            │ ──> Synthesizes human-like timing &
 │ (Transformer / Diffusion Network)    │     organic mouse curves (Clones B)
 └──────────────────────────────────────┘
                    │  (Outputs Coordinates & Delays)
                    ▼
 ┌──────────────────────────────────────┐
 │    BROWSER ARCHITECTURE LAYER        │ ──> Patches navigator.webdriver,
 │ (Stealth Patching / Kernel Hooks)    │     masks CDP, spoofs WebGL (Clones H)
 └──────────────────────────────────────┘
                    │
                    ▼
           [ Target Website ]
       (Sees "You" Completely)
```

This stack combines behavioral cloning with infrastructure stealth tools (e.g., `playwright-extra-stealth`, kernel-level browser hooking, or enterprise-managed stealth execution environments) that:
- Rewrite browser primitive JavaScript properties before page initialization
- Override object behaviors to mask automation flags
- Spoof WebGL, canvas, and audio fingerprints to match the target user's $\mathbf{H}$

### 10.5 Implications for the BBID Protocol

#### 10.5.1 Successful Spoofing Scenario

If the adversary successfully combines behavioral cloning with architectural stealth, the synthesized behavioral stream $\hat{\mathbf{B}}$ passes through the SRP-LSH projection:

$$
\hat{\mathbf{w}} = h_{\text{SRP}}(\hat{\mathbf{B}})
$$

The resulting bitstring satisfies:

$$
d_H(\hat{\mathbf{w}}, \mathbf{w}_{\text{enrolled}}) \leq t
$$

The BCH decoder successfully recovers the canonical codeword $\mathbf{c}$, and the server authenticates the AI agent as the genuine user.

#### 10.5.2 Entropy Reduction Under Cloning

The effective entropy of the behavioral subspace is reduced when an adversary possesses a trained cloning model. The min-entropy of $\mathbf{B}$ conditioned on the model parameters $\theta$ is:

$$
H_\infty(\mathbf{B} \mid \theta) \leq H_\infty(\mathbf{B}) - I(\mathbf{B}; \theta)
$$

where $I(\mathbf{B}; \theta)$ is the mutual information between the behavioral distribution and the model parameters. As model fidelity improves, $I(\mathbf{B}; \theta)$ increases, reducing the effective security margin.

### 10.6 Countermeasures

#### 10.6.1 Liveness Detection

The BBID protocol incorporates liveness detection to distinguish genuine human behavior from synthesized behavior:

- **Micro-timing analysis**: AI-generated behavior exhibits subtle statistical artifacts in inter-event timing distributions that differ from human motor noise
- **Cross-modal consistency**: Genuine human behavior exhibits correlations between typing, mouse, and scroll patterns that are difficult for independent generative models to replicate simultaneously
- **Challenge-response perturbations**: The server injects randomized UI perturbations (button displacement, timing jitter) and verifies that the behavioral response exhibits human-like adaptation latency

#### 10.6.2 Multi-Modal Verification

Combining behavioral biometrics with additional verification factors raises the cloning difficulty:

- **Hardware attestation**: Require TPM-backed device attestation that binds $\mathbf{H}$ to a trusted execution environment
- **Biometric fusion**: Combine behavioral patterns with physical biometrics (face, voice) that are harder to clone remotely
- **Environmental coherence**: Verify consistency between reported timezone, language, and behavioral patterns

#### 10.6.3 Adversarial Training

The projection matrix $\mathcal{R}_u$ is adversarially trained to maximize sensitivity to synthetic behavioral artifacts:

$$
\mathcal{R}_u^* = \arg\max_{\mathcal{R}} \mathbb{E}_{\mathbf{B} \sim P_{\text{human}}} \left[d_H(h_{\text{SRP}}(\mathbf{B}), h_{\text{SRP}}(\hat{\mathbf{B}}_{\text{AI}}))\right]
$$

This creates a projection space where AI-generated behavior maps to a distinct region from genuine human behavior, even when the raw behavioral features appear similar.

#### 10.6.4 Rate Limiting and Anomaly Detection

- **Session velocity monitoring**: AI agents operate at superhuman speeds; rate-limiting authentication attempts detects automated replay
- **Behavioral drift tracking**: Abrupt shifts in behavioral patterns (consistent with model deployment) trigger re-verification
- **Graph-based anomaly detection**: Neo4j identity graph analysis detects anomalous authentication patterns across the user population

### 10.7 The Arms Race

The conflict between behavioral cloning and behavioral verification represents an ongoing arms race:

| Capability | Attacker (Cloning) | Defender (Verification) |
|-----------|-------------------|------------------------|
| Keystroke timing | Log-normal distribution fitting | Micro-timing anomaly detection |
| Mouse trajectories | Diffusion/GAN synthesis | Cross-modal consistency checks |
| Hardware fingerprint | Stealth browser patching | TPM-backed hardware attestation |
| Network fingerprint | TLS stack modification | JA4 fingerprint monitoring |
| Liveness | Adversarial training of generators | Challenge-response perturbations |

The BBID protocol acknowledges that no single countermeasure provides absolute security. Defense-in-depth, combining liveness detection, multi-modal verification, adversarial training, and anomaly detection, raises the cost of successful cloning to a level that deters all but the most sophisticated adversaries.

### 10.8 Conclusion

Transformer-based behavioral cloning represents a credible threat to behavioral biometric systems. An adversary with access to a user's behavioral data can train a generative model that synthesizes convincing behavioral streams, potentially defeating the BBID authentication pipeline when combined with architectural stealth tools.

However, the BBID protocol's defense-in-depth architecture—incorporating liveness detection, multi-modal verification, adversarially trained projections, and graph-based anomaly detection—provides multiple independent layers of protection. The protocol is designed not to be unbreakable, but to raise the cost of successful spoofing beyond the value of the protected resource.

Future research should focus on provable bounds for liveness detection accuracy, formal verification of cross-modal consistency properties, and the development of hardware-backed behavioral attestation primitives that bind behavioral patterns to trusted execution environments.

---

## References

[1] Zero Trust Security | What's a Zero Trust Network? - Cloudflare, accessed May 19, 2026, https://www.cloudflare.com/learning/security/glossary/what-is-zero-trust/

[2] A Secure Biometric Key Generation Mechanism via Deep Learning and Its Application, accessed May 19, 2026, https://www.mdpi.com/2076-3417/11/18/8497

[3] Biometrics for Robots: Why Every Humanoid AI Needs a Hardware Fingerprint, accessed May 19, 2026, https://dev.to/scottcjn/biometrics-for-robots-why-every-humanoid-ai-needs-a-hardware-fingerprint-208g

[4] Research Article Construction of a New Biometric-Based Key Derivation Function and Its Application, accessed May 19, 2026, https://ksp.etri.re.kr/ksp/article/file/60176.pdf

[5] Model Inversion Attacks Meet Cryptographic Fuzzy Extractors - arXiv, accessed May 19, 2026, https://arxiv.org/html/2510.25687v1

[6] A cancelable biometric authentication system based on feature-adaptive random projection - Edith Cowan University, accessed May 19, 2026, https://ro.ecu.edu.au/context/ecuworkspost2013/article/10594/viewcontent/A_cancelable_biometric_authentication_system_based_on_feature_adaptive_random_projection.pdf

[7] Biometric Template-Based Reconstruction Attack in Machine Learning | Request PDF, accessed May 19, 2026, https://www.researchgate.net/publication/399983280_Biometric_Template-Based_Reconstruction_Attack_in_Machine_Learning

[8] Biometric Template Protection for Dynamic Touch Gestures Based on Fuzzy Commitment Scheme and Deep Learning - MDPI, accessed May 19, 2026, https://www.mdpi.com/2227-7390/10/3/362

[9] Two-Factor Fuzzy Commitment for Unmanned IoT Devices Security - IEEE Xplore, accessed May 19, 2026, https://ieeexplore.ieee.org/iel7/6488907/8651406/08360476.pdf

[10] WiFaKey: Generating Cryptographic Keys from Face in the Wild - arXiv, accessed May 19, 2026, https://arxiv.org/html/2407.14804v1

[11] Reinforced Palmprint Reconstruction Attacks in Biometric Systems - PMC, accessed May 19, 2026, https://pmc.ncbi.nlm.nih.gov/articles/PMC8781289/

[12] Construction of a New Biometric-Based Key Derivation Function and Its Application, accessed May 19, 2026, https://www.researchgate.net/publication/329370032_Construction_of_a_New_Biometric-Based_Key_Derivation_Function_and_Its_Application

[13] (PDF) Dynamic random projection for biometric template protection - ResearchGate, accessed May 19, 2026, https://www.researchgate.net/publication/224194518_Dynamic_random_projection_for_biometric_template_protection

[14] A Non-Invertible Secure Template Generation Using AES Encrypted MCC and Random Triangle Projection - IEEE Xplore, accessed May 19, 2026, https://ieeexplore.ieee.org/iel8/6287639/10820123/10971173.pdf

[15] Cancelable biometrics - Scholarpedia, accessed May 19, 2026, http://www.scholarpedia.org/article/Cancelable_biometrics

[16] Random Projection for Locality Sensitive Hashing - Pinecone, accessed May 19, 2026, https://www.pinecone.io/learn/series/faiss/locality-sensitive-hashing-random-projection/

[17] Learning to Hash for Source Separation - Minje Kim's Home, accessed May 19, 2026, https://minjekim.com/research-projects/bwss-blsh/

[18] songruizhe/Image-Retrieval-Using-Locality-Sensitive-Hashing-Algorithm - GitHub, accessed May 19, 2026, https://github.com/songruizhe/Image-Retrieval-Using-Locality-Sensitive-Hashing-Algorithm

[19] An analysis of random projection for changeable and privacy-preserving biometric verification - PubMed, accessed May 19, 2026, https://pubmed.ncbi.nlm.nih.gov/20083458

[20] Efficient Known-Sample Attack for Distance-Preserving Hashing Biometric Template Protection Schemes - IRIS, accessed May 19, 2026, https://iris.uniss.it/retrieve/e1dc1a2c-e4ec-1507-e053-3a05fe0ac7a3/TIFS3073802.pdf

[21] Spiral Cube for Biometric Template Protection - Computer Science & Engineering, accessed May 19, 2026, https://www.cse.unr.edu/~bebis/ICISP12.pdf

[22] Learning to Hash with Binary Reconstructive Embeddings, accessed May 19, 2026, https://people.bu.edu/bkulis/pubs/bre_nips.pdf

[23] Improving LSH via Tensorized Random Projection - arXiv, accessed May 19, 2026, https://arxiv.org/html/2402.07189v2

[24] A New Biometric Template Protection using Random Orthonormal Projection and Fuzzy Commitment - arXiv, accessed May 19, 2026, https://arxiv.org/pdf/1904.00264

[25] Dense Fast Random Projections and Lean Walsh Transforms - Edo Liberty, accessed May 19, 2026, https://edoliberty.github.io/papers/leanWalshRandom08.pdf

[26] Dynamic Random Projection for Biometric Template Protection - COSIC, accessed May 19, 2026, https://cosicdatabase.esat.kuleuven.be/backend/publications/files/conferencepaper/1478

[27] Dense Fast Random Projections and Lean Walsh Transforms - Math (Princeton), accessed May 19, 2026, https://web.math.princeton.edu/~amits/publications/LeanWalsh_published.pdf

[28] Ur-Eine/distribution-aware-LSH - GitHub, accessed May 19, 2026, https://github.com/Ur-Eine/distribution-aware-LSH

[29] A Deterministic Method for Initializing K-means Clustering - Electrical and Computer Engineering, accessed May 19, 2026, https://ece.northeastern.edu/faculty/jdy/papers/init-k-means.pdf

[30] (PDF) A fuzzy commitment scheme (1999) | Ari Juels | 1880 Citations - SciSpace, accessed May 19, 2026, https://scispace.com/papers/a-fuzzy-commitment-scheme-27akg5gt4l?citations_page=97

[31] SCIENCE AND TECHNOLOGY PUBLICATIONS - SciTePress, accessed May 19, 2026, https://www.scitepress.org/Papers/2015/

[32] A FUZZY COMMITMENT SCHEME WITH MCELIECE'S CIPHER 1 Introduction, accessed May 19, 2026, https://www.utgjiu.ro/math/sma/v05/p06.pdf

[33] An Analysis of Random Projection for Changeable and Privacy-Preserving Biometric Verification, accessed May 19, 2026, http://www.ipsi.utoronto.ca/docs/WangPlantaniotis-BioVerification.pdf

[34] Two-factor-based RSA key generation from fingerprint biometrics and password for secure communication, accessed May 19, 2026, https://d-nb.info/1258143836/34

[35] (PDF) A Fuzzy Commitment Scheme - ResearchGate, accessed May 19, 2026, https://www.researchgate.net/publication/2577452_A_Fuzzy_Commitment_Scheme

[36] The Practical Subtleties of Biometric Key Generation - USENIX, accessed May 19, 2026, https://www.usenix.org/event/sec08/tech/full_papers/ballard/ballard.pdf

[37] A Roadmap to Zero Trust Architecture - Cloudflare, accessed May 19, 2026, https://cf-assets.www.cloudflare.com/slt3lc6tev37/5ZpKYUIZJnZezJgWVdevwi/ca995883d72fa871f8588e5b53aacb88/White-Paper-Zero-Trust-Roadmap-v2.pdf

[38] ECLARISS: Security-by-Design Smart-Home Surveillance System with Edge Dynamic Biohashing - ResearchGate, accessed May 19, 2026, https://www.researchgate.net/publication/402245117_ECLARISS_Security-by-Design_Smart-Home_Surveillance_System_with_Edge_Dynamic_Biohashing

[39] Model inversion attack - Wikipedia, accessed May 19, 2026, https://en.wikipedia.org/wiki/Model_inversion_attack

[40] (PDF) Model Inversion Attack Against Deep Hashing - ResearchGate, accessed May 19, 2026, https://www.researchgate.net/publication/397700081_Model_Inversion_Attack_Against_Deep_Hashing

[41] [2511.12233] Model Inversion Attack Against Deep Hashing - arXiv, accessed May 19, 2026, https://arxiv.org/abs/2511.12233

[42] US8384515B2 - Biometric processing using random projection transforms - Google Patents, accessed May 19, 2026, https://patents.google.com/patent/US8384515B2

[43] ECLARISS: Security-by-Design Smart-Home Surveillance System with Edge Dynamic Biohashing - SciTePress, accessed May 19, 2026, https://www.scitepress.org/Papers/2026/144686/144686.pdf

[44] Zero Trust | Cloudflare Impact, accessed May 19, 2026, https://www.cloudflare.com/impact-portal/zero-trust/

[45] US20150263857A1 - Dynamic seed and key generation from biometric indicia - Google Patents, accessed May 19, 2026, https://patents.google.com/patent/US20150263857A1/en

[46] Deterministic Cryptographic Seed Generation via Cyclic Modular Inversion over Z/3 - arXiv, accessed May 19, 2026, https://arxiv.org/pdf/2507.03000

[47] Deterministic Cryptographic Seed Generation via Cyclic Modular Inversion over ℤ/3^p⁢ℤ, accessed May 19, 2026, https://arxiv.org/html/2507.03000v1

[48] How to implement Zero Trust security | Step-by-step guide - Cloudflare, accessed May 19, 2026, https://www.cloudflare.com/learning/access-management/how-to-implement-zero-trust/
