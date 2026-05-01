FROM node:18-alpine

COPY src/* /usr/app/

WORKDIR /usr/app

RUN npm install

CMD ["node", "index.js"]
