FROM node:20-alpine AS builder

WORKDIR /app

# Archivos de empaquetado para instalar dependencias primero
COPY package*.json ./
RUN npm ci

# Copiar todo el código (excepto lo en .dockerignore)
COPY . .

# Compilar proyecto y backend
RUN npm run build

# Imagen final productiva
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Si necesitas credenciales o firebase configs, asegúrate de añadirlas por variable de entorno o en la plataforma.
# COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

ENV NODE_ENV=production

CMD ["npm", "start"]
