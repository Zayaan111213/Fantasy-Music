-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "proposerTeamId" TEXT NOT NULL,
    "receiverTeamId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeItem" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "fromTeamId" TEXT NOT NULL,
    "toTeamId" TEXT,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeVeto" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeVeto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trade_leagueId_status_idx" ON "Trade"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeItem_tradeId_artistId_key" ON "TradeItem"("tradeId", "artistId");

-- CreateIndex
CREATE INDEX "TradeItem_artistId_idx" ON "TradeItem"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeVeto_tradeId_teamId_key" ON "TradeVeto"("tradeId", "teamId");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_proposerTeamId_fkey" FOREIGN KEY ("proposerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_receiverTeamId_fkey" FOREIGN KEY ("receiverTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeVeto" ADD CONSTRAINT "TradeVeto_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeVeto" ADD CONSTRAINT "TradeVeto_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
