# Zweistufig: Die Build-Stufe erzeugt die geschützte Ausgabe (Bytecode, verschleierte Browser-Skripte).
# Das Laufzeit-Image enthält keinen lesbaren Quelltext.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node tools/build-protect.js --out /out

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
ENV PORT=4001 DATA_DIR=/data
VOLUME /data
EXPOSE 4001
CMD ["node", "server.js"]
