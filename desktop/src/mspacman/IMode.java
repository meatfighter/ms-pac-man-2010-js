package mspacman;

import org.newdawn.slick.*;

public interface IMode {
  public void init(Main main, GameContainer gc) throws SlickException;
  public void update(GameContainer gc) throws SlickException;
  public void render(GameContainer gc, Graphics g) throws SlickException;
}
