# Vercel link — bina login / permission (Urdu)

Jab tum checklist link kisi ko bhejte ho aur **Vercel login** ya **permission** aata hai, yeh **Deployment Protection** ki wajah se hai.

---

## 2 minute fix

1. [dashboard.vercel.com](https://vercel.com/dashboard)
2. Project kholo (jaise `automation-checklists`)
3. **Settings** (left) → **Deployment Protection**
4. **Production**:
   - **Vercel Authentication** → **Disabled / Off**
5. **Preview** (agar preview URLs share karte ho):
   - Bhi **Off** karo, **ya** preview mat do — sirf Production URL do
6. Save

Ab wohi link dubara kholo **incognito / dusre browser** mein — login nahi mangna chahiye.

---

## Kaunsi URL bhejo

**Sahi (public):**

`https://automation-checklists.vercel.app`  
(apna project name — **Deployments** → **Production** → **Visit**)

**Galat (login mangta hai):**

`https://automation-checklists-git-main-….vercel.app`  
(preview / branch URL)

---

## Test

Incognito window:

1. `https://<project>.vercel.app` — page khule
2. `https://<project>.vercel.app/api/ping` — JSON `{"ok":true,...}`

Dono bina login = theek.

---

## Hobby (free) plan note

- **Production domain** usually **public** rehta hai
- **Preview** URLs often **protected** (Vercel team login)

Is liye clients ko **Production URL** hi do.
