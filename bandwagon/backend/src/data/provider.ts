export interface DataProvider {
  getWeeklyStreams(artistId: string, week: number, year: number): Promise<number | null>;
  getBestChartPosition(artistId: string, week: number, year: number): Promise<number | null>;
  getChartMovement(artistId: string, week: number, year: number): Promise<number | null>;
}
