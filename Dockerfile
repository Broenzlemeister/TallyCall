FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=4001 DATA_DIR=/data
VOLUME /data
EXPOSE 4001
CMD ["node", "server.js"]
