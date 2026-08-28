FROM docker/sandbox-templates:claude-code

USER root
COPY shared/install-command-center.sh /tmp/install-command-center.sh
RUN chmod +x /tmp/install-command-center.sh && /tmp/install-command-center.sh

USER agent
RUN --mount=type=cache,target=/tmp/npm-cache,sharing=locked,mode=0777 \
    npm install -g @command-center-ai/command-center \
      --cache=/tmp/npm-cache \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=600000 \
      --no-audit \
      --no-fund && \
    command-center --version

COPY --chown=agent:agent shared/start-command-center.sh /home/agent/.command-center-start.sh
RUN echo '. ~/.command-center-start.sh' >> /home/agent/.bashrc
