import { make2D } from "./JavaMath";

export class Stage {
    public tileMap = make2D(31, 28);
    public regionMap = make2D(31, 28);
    public homeTree = make2D(31, 28);
    public leftExitMaps: number[][][] = [];
    public rightExitMaps: number[][][] = [];
    public pelletCount = 0;
    public regionCount = 0;
}
