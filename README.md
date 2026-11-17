# 🐳 TaskFlow 3.0

**TaskFlow** és una aplicació web de gestió de projectes i tasques amb tauler Kanban, treball col·laboratiu, estadístiques i un assistent d'intel·ligència artificial que pot funcionar localment amb Ollama.

> **Estat:** projecte de desenvolupament local. No està preparat per exposar-se directament a Internet sense revisar-ne la seguretat i la configuració de desplegament.

## ✨ Funcionalitats

- **Projectes i equips:** registre, inici de sessió, projectes compartits i rols de **Propietari**, **Editor** i **Lector**.
- **Gestió de tasques:** títol, descripció, prioritat, estat, dates límit, responsables i edició massiva.
- **Kanban i calendari:** arrossegar tasques entre columnes, consultar-les en un calendari i filtrar-les.
- **Subtasques i checklists:** passos assignables amb seguiment del progrés.
- **Gantt i dependències:** visualització temporal i relacions entre tasques (informatives, no bloquejants).
- **Historial d'activitat:** seguiment de canvis nous dins dels projectes.
- **Automatitzacions recurrents:** tasques diàries, setmanals o mensuals.
- **Cercador global:** cerca als projectes accessibles, tasques i comentaris.
- **Col·laboració:** comentaris, notificacions dins de l'aplicació i fitxers adjunts.
- **Estadístiques:** distribució per estat, prioritat, membre i venciments.
- **IA opcional:** assistent per generar suggeriments, resumir projectes i identificar riscos, amb **Ollama** o una API externa segons la configuració.

## 🛠️ Tecnologies

| Capa | Tecnologia |
| --- | --- |
| Frontend | React 18, Vite 6, JavaScript i CSS |
| Backend | Python 3.12, FastAPI i SQLAlchemy |
| Base de dades | PostgreSQL 16 |
| Autenticació | JWT i hashing de contrasenyes |
| Contenidors | Docker i Docker Compose |
| IA local | Ollama (`llama3.2:3b`) |

## 📁 Estructura del projecte

```text
TaskFlow/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── Features30.jsx
│   │   ├── ProjectStats.jsx
│   │   ├── TaskComments.jsx
│   │   ├── TaskAttachments.jsx
│   │   └── NotificationCenter.jsx
│   ├── package.json
│   └── Dockerfile
├── migrations/
├── uploads/                 # Dades locals, no versionades
├── docker-compose.yml
├── .env                     # Secrets locals, no versionats
├── .env.example             # Plantilla sense secrets
└── README.md
```

## 🚀 Executar el projecte en local

### Requisits

- Git
- Docker Desktop amb Docker Compose
- Opcional per a la IA local: [Ollama](https://ollama.com/download) i un model descarregat

### 1. Clonar el repositori

```powershell
git clone https://github.com/Sgallartfanlo/TaskFlow.git
cd TaskFlow
```

### 2. Preparar l'entorn

Crea el fitxer `.env` a partir de `.env.example` i substitueix els valors d'exemple per secrets propis:

```powershell
Copy-Item .env.example .env
```

Variables principals:

```dotenv
POSTGRES_PASSWORD=posa_aqui_una_contrasenya_segura
JWT_SECRET=posa_aqui_una_clau_llarga_i_aleatoria
AI_PROVIDER=ollama
AI_MODEL=llama3.2:3b
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

> `docker-compose.yml` ha de llegir `POSTGRES_PASSWORD` i `JWT_SECRET` de les variables d'entorn; **no** hi escriguis les claus o contrasenyes reals. Mantén `.env` fora de Git.

### 3. Iniciar els contenidors

```powershell
docker compose config --quiet
docker compose up -d --build
```

### 4. Preparar la base de dades

El projecte inclou scripts de migració a `migrations/`. Per a una **actualització des de TaskFlow 2.9** amb les taules prèvies creades, la migració 3.0 és:

```powershell
Get-Content -Raw -Encoding UTF8 .\migrations\006_taskflow30.sql |
  docker exec -i taskflow_db psql -X -v ON_ERROR_STOP=1 -U taskflow -d taskflow
```

**Instal·lació des de zero:** cal inicialitzar primer les taules bàsiques (`projects`, `tasks`, `users`) i aplicar després les migracions pertinents en ordre. Els scripts `001`–`006` provenen de versions incrementals i **no constitueixen per si sols un instal·lador complet des de zero**. El fitxer `002_assign_legacy_projects.sql` és opcional i només serveix per migrar projectes antics. Abans d'executar scripts sobre una base de dades amb dades, fes una còpia de seguretat.

### 5. Accedir a l'aplicació

- **Frontend:** http://localhost:5173
- **Documentació interactiva de l'API:** http://localhost:8000/docs

## 🤖 Configurar la IA local amb Ollama

1. Instal·la [Ollama](https://ollama.com/download) a l'ordinador amfitrió.
2. Descarrega el model:

   ```powershell
   ollama pull llama3.2:3b
   ```

3. Comprova'l amb `ollama list` i verifica que Ollama respon a `http://localhost:11434/api/tags`.
4. Configura `.env` amb `AI_PROVIDER=ollama`, `AI_MODEL=llama3.2:3b` i `OLLAMA_BASE_URL=http://host.docker.internal:11434`.
5. Aplica la configuració amb `docker compose up -d --build backend frontend` i obre la pestanya **IA**.

La IA local **no necessita una clau API d'OpenAI**. Per utilitzar una API externa, cal configurar el proveïdor i les credencials corresponents al backend. No publiquis mai claus API.

## 🔐 Seguretat i dades

- Els rols de projecte controlen l'accés a les funcionalitats compartides.
- El backend autentica les peticions amb JWT.
- Els fitxers adjunts es desen a `uploads/` i no s'han d'afegir al repositori.
- `.env`, còpies de base de dades, fitxers adjunts i entorns virtuals han de quedar exclosos amb `.gitignore`.
- **Atenció:** `docker-compose.yml` està pensat per a desenvolupament local. Abans d'exposar el servei públicament cal revisar autenticació, gestió de secrets, CORS, HTTPS, permisos, límits de fitxers i estratègia de còpies i restauració.

## 💾 Còpies de seguretat

Exemple de còpia de PostgreSQL en format personalitzat:

```powershell
docker exec taskflow_db pg_dump -U taskflow -d taskflow -Fc -f /tmp/taskflow_backup.dump
docker cp taskflow_db:/tmp/taskflow_backup.dump .\taskflow_backup.dump
```

Conserva també la carpeta `uploads/`: les metadades dels adjunts són a PostgreSQL, però els fitxers físics es guarden separadament.

## 🧪 Estat i limitacions

- **Gantt:** les dependències són informatives; no impedeixen automàticament completar tasques.
- **Historial:** registra els canvis a partir de la seva implementació; no reconstrueix el passat.
- **Automatitzacions:** el comportament depèn de les execucions programades i del processament del backend. Cal validar especialment les dates i els reintents.
- **IA:** la qualitat i el temps de resposta depenen del model i dels recursos de l'ordinador.
- **Desplegament:** l'objectiu actual és l'ús en desenvolupament local.

## 📄 Llicència

En aquest moment no s'ha definit cap llicència de distribució. Afegir un fitxer `LICENSE` és una decisió pendent abans de permetre'n la reutilització sota una llicència oberta.
