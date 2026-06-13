# 한별 AI 백엔드 — 시놀로지 NAS Container Manager용
FROM node:20-alpine
WORKDIR /app
COPY server.js .
EXPOSE 8787
# 환경변수(ANTHROPIC_API_KEY 등)는 컨테이너 실행 시 주입
CMD ["node", "server.js"]
