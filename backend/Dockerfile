
# Imatge base de Python
FROM python:3.12-slim

# Directori de treball
WORKDIR /app

# Copiar el fitxer de dependències
COPY requirements.txt .

# Instal·lar les dependències
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el codi del backend
COPY . .

# Port de FastAPI
EXPOSE 8000

# Iniciar el servidor
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
