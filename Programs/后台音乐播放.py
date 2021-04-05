import sys
import pygame
import time
try:
    path = sys.argv[1]
    pygame.mixer.init()
    pygame.mixer.music.load(path)
    pygame.mixer.music.play(start = 0.0)
    time.sleep(300)
    pygame.mixer.music.stop()
except:
    pass
