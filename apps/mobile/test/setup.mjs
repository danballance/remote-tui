process.env.APP_MANIFEST = JSON.stringify({
  extra: {
    remoteDeck: {
      agentUrl: "http://127.0.0.9:4567",
      refreshDelayMs: 17,
      terminal: {
        columns: 99,
        rows: 31,
        fontSize: 10,
        maxFittedFontSize: 40,
      },
    },
  },
});
