from .base_settings import *

# Host
ALLOWED_HOSTS = ["kbpo.stanford.edu"]

# Debug
DEBUG = False

# Location
STATIC_ROOT = "/data/kbpo/web/static"
MEDIA_ROOT = "/data/kbpo/web/media"

# Database
# https://docs.djangoproject.com/en/1.11/ref/settings/#databases

DATABASES = {
    'test': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'kbpo_test',
        'USER': 'kbpo',
        'PASSWORD': 'kbpo',
        'HOST': 'localhost',
        'PORT': 5432, # Linked to KBPO.stanford.edu
    },
    'production': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'kbpo',
        'USER': 'kbpo',
        'PASSWORD': 'kbpo',
        'HOST': 'localhost',
        'PORT': 5432, # Linked to KBPO.stanford.edu
    },
}
DATABASES['default'] = DATABASES['production']

# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'DEBUG',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': '/data/kbpo/web/django.log',
        },
        'kbpo': {
            'level': 'DEBUG',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': '/data/kbpo/web/kbpo.log',
        },
        'celery': {
            'level': 'DEBUG',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': '/data/kbpo/web/celery.log',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file'],
            'level': 'INFO',
            'propagate': True,
        },
        'kbpo': {
            'handlers': ['file', 'kbpo'],
            'level': 'INFO',
            'propagate': True,
        },
        'celery': {
            'handlers': ['file', 'celery'],
            'level': 'INFO',
            'propagate': True,
        },
        'root': {
            'handlers': ['file'],
            'level': 'INFO',
            'propagate': True,
        },
    },
}
