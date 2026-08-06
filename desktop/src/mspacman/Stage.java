package mspacman;

public class Stage {
  public int[][] tileMap = new int[31][28];
  public int[][] regionMap = new int[31][28];
  public int[][] homeTree = new int[31][28];
  public int[][][] leftExitMaps;
  public int[][][] rightExitMaps;
  public int pelletCount;
  public int regionCount;
}
