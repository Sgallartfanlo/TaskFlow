
# Imatge base de Node.js
FROM node:22-alpine

# Directori de treball
WORKDIR /app

# Copiar les dependències
COPY package.json .

# Instal·lar les dependències
RUN npm install

# Copiar els fitxers del frontend
COPY . .

# Port de Vite
EXPOSE 5173

# Iniciar el servidor de desenvolupament
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
